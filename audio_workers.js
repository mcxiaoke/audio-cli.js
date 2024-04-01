const { spawnSync } = require("child_process");
const iconv = require("iconv-lite");
const workerpool = require("workerpool");
const path = require("path");
const fs = require("fs-extra");
const log = require("./lib/debug");
const h = require("./lib/helper");
const cue = require("./lib/cue");

function executeCommand(command, args = []) {
  const argsStr = args.join(" ");
  const result = spawnSync(command, args);
  log.info(command, argsStr);
  let output;
  if (result.status != 0) {
    output = iconv.decode(result.stderr, "utf8");
    log.error(
      "executeCommand",
      command,
      argsStr,
      result.status,
      output,
      process.pid
    );
  } else {
    output = iconv.decode(result.stdout, "utf8");
    log.debug("executeCommand", command, argsStr, output, process.pid);
  }
  return {
    command: command,
    args: args,
    status: result.status,
    ok: result.status == 0,
    output: output,
  };
}

function cmdExifTool(file) {
  const result = spawnSync("exiftool", ["-j", file]);
  try {
    return JSON.parse(iconv.decode(result.stdout, "utf8"))[0];
  } catch (error) {
    log.error("cmdExifTool", error, file);
  }
}

function cmdFFProbe(file) {
  const args =
    "-hide_banner -loglevel fatal -show_error -show_format -show_streams -show_programs -show_chapters -print_format json".split(
      " "
    );
  const result = spawnSync("ffprobe", args);
  try {
    return JSON.parse(iconv.decode(result.stdout, "utf8"))[0];
  } catch (error) {
    log.error("cmdFFProbe", error, file);
  }
}

function getFFmpegArgs(track, options) {
  const fileSrc = track.file;
  log.debug("getFFmpegArgs input:", fileSrc);
  const dstDir = path.dirname(fileSrc);
  const dstName = `${track.artist} @ ${track.title}.m4a`;
  const fileDst = path.join(dstDir, dstName);
  let args = "-loglevel repeat+level+debug".split(" ");
  if (track.ss) {
    args.push("-ss");
    args.push(track.ss);
  }
  if (track.to) {
    args.push("-to");
    args.push(track.to);
  }
  args.push("-i");
  args.push(`${fileSrc}`);
  // begin insert metadata
  args.push("-metadata");
  args.push(`title=${track.title}`);
  args.push("-metadata");
  args.push(`artist=${track.artist}`);
  args.push("-metadata");
  args.push(`author=${track.artist}`);
  args.push("-metadata");
  args.push(`album_artist=${track.artist}`);
  if (track.album) {
    args.push("-metadata");
    args.push(`album=${track.album}`);
  }
  args.push("-metadata");
  args.push(`track=${track.index}`);
  // end insert metadata
  // aac ir libfdk_aac (if support)
  args = args.concat(
    `-map a:0 -c:a ${options.useLibfdkAAC ? "libfdk_aac" : "aac"
      } -b:a 320k`.split(" ")
  );
  args.push(`${fileDst}`);
  args.push("-hide_banner");
  log.debug("getFFmpegArgs", "ffmpeg", args);
  return {
    fileDst: fileDst,
    index: track.index,
    args: args,
  };
}

// convert one ape/wav/flac file with cue to multi aac tracks
function splitTracks(file, i, options) {
  options = options || {};
  options.logLevel && log.setLevel(options.logLevel);
  log.info(`Processing(${i}):`, file.path, options);
  // ffmpeg -ss 00:00:00.00 -to 00:04:34.35 -i .\女生宿舍.ape -map a:0 -c:a libfdk_aac -b:a 320k -metadata title="恋人未满" -metadata artist="S.H.E" -metadata album="女生宿舍" track01.m4a
  const fileSrc = path.resolve(file.path);
  const audioName = path.basename(file.audio);

  let tracks;
  try {
    tracks = cue.parseAudioTracks(file);
  } catch (error) {
    tracks = null;
    log.error(`splitTracks(${i}):`, i, error, fileSrc);
  }
  if (!tracks || tracks.length == 0) {
    log.warn("splitTracks(${i}):", "no tracks found", fileSrc);
    return {
      file: file,
      skipped: [],
      failed: [{ file: fileSrc, error: "Failed to parse cue" }],
    };
  }

  const failed = [];
  const skipped = [];
  for (const track of tracks) {
    const ta = getFFmpegArgs(track, options);
    log.debug(
      "splitTracks Begin:",
      `${file.audio} Track-${ta.index}:`,
      path.basename(ta.fileDst)
    );
    if (fs.pathExistsSync(ta.fileDst)) {
      skipped.push({ file: ta.fileDst });
      log.info(
        "splitTracks Skip:",
        `${file.audio} Track-${ta.index}:`,
        path.basename(ta.fileDst)
      );
      continue;
    }
    const r = executeCommand("ffmpeg", ta.args);
    if (r.status == 0) {
      log.show(
        "splitTracks Save:",
        `${file.audio} Track-${ta.index}:`,
        path.basename(ta.fileDst)
      );
    } else {
      log.error(
        "splitTracks Error:",
        `${audioName} Track-${ta.index}:`,
        r.output,
        ta.fileDst
      );
      failed.push({ file: ta.fileDst, error: r.output });
    }
  }
  skipped.length > 0 &&
    log.warn(
      "splitTracks Result:",
      `Skip ${skipped.length} tracks of`,
      file.audio,
      path.basename(file.path)
    );
  if (failed.length == 0) {
    log.showGreen(
      `splitTracks(${i}): All Tracks OK`,
      file.audio,
      path.basename(file.path)
    );
  } else {
    log.warn(
      `splitTracks(${i}): Some Tracks OK`,
      `${failed.length} failed`,
      file.audio,
      path.basename(file.path)
    );
  }
  const r = {
    file: file,
    failed: failed,
    skipped: skipped,
  };
  return r;
}

const QUALITY_LIST = ["0", "128", "192", "256", "320"];

// convert one mp3/ape/wav/flac to single aac file
function convertAudio(file, i, total, options) {
  options = options || {};
  options.logLevel && log.setLevel(options.logLevel);
  log.info(`Processing(${i}):`, file.path, options);
  // ls *.mp3 | parallel ffmpeg -n -loglevel repeat+level+warning -i "{}" -map a:0 -c:a libfdk_aac -b:a 192k output/"{.}".m4a -hide_banner

  let quality;
  if (QUALITY_LIST.includes(options.quality)) {
    quality = `${options.quality}k`;
  } else if (!file.lossless && file.bitrate <= 320) {
    quality = file.bitrate > 256 ? "256k" : "192k";
  } else {
    quality = "320k";
  }

  const fileSrc = path.resolve(file.path);
  const [dir, base, ext] = h.pathSplit(fileSrc);
  const dstDir = options.output ? h.pathRewrite(dir, options.output) : dir;
  const fileDst = path.join(dstDir, `${base} [${quality}].m4a`);
  const fileDstTemp = path.join(dstDir, `TMP ${base} [${quality}].m4a`);
  const fileDstSameDir = path.join(dir, `${base} [${quality}].m4a`);
  if (fs.pathExistsSync(fileDst)) {
    log.warn(`SkipExists1(${i}):`, fileDst);
    return { status: 0, output: "", file: fileSrc };
  }
  if (fs.pathExistsSync(fileDstSameDir)) {
    log.warn(`SkipExists2(${i}):`, fileDstSameDir);
    return { status: 0, output: "", file: fileDstSameDir };
  }
  let args = "-hide_banner -n -loglevel repeat+level+info -i".split(" ");
  args.push(fileSrc);
  args = args.concat(
    `-map a:0 -c:a ${options.useLibfdkAAC ? "libfdk_aac" : "aac"} -b:a`.split(
      " "
    )
  );

  args.push(quality);
  // args.push("-f mp4");
  args.push(fileDstTemp);
  log.debug(i, "ffmpeg", args);
  fs.ensureDirSync(dstDir);
  log.show(`Converting(${i}/${total}):`, h.ps(fileSrc), file.bitrate, file.lossless);
  log.info(`Converting(${i}/${total}):`, args);
  const result = executeCommand("ffmpeg", args);
  if (result.status == 0) {
    fs.renameSync(fileDstTemp, fileDst);
    log.showGreen(`Converted(${i}/${total}):${h.ps(fileDst)} ${quality}`);
    //caution: delete orignal audio file
    // try {
    //   fs.rmSync(fileSrc);
    //   d.L(chalk.gray(`Delete SRC OK: (${index}): ${h.ps(fileSrc)}`));
    // } catch (error) {
    //   d.L(
    //     chalk.yellow(`Delete SRC Error: (${index}): ${h.ps(fileSrc)} ${error}`)
    //   );
    // }
  } else {
    fs.removeSync(fileDstTemp);
    log.error(`Error(${i}):`, fileSrc, result.output.substring(0, 80));
  }
  return result;
}

// https://github.com/josdejong/workerpool
// https://www.npmjs.com/package/workerpool
workerpool.worker({
  cmdExifTool: cmdExifTool,
  cmdFFProbe: cmdFFProbe,
  convertAudio: convertAudio,
  splitTracks: splitTracks,
});
