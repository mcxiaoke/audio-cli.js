const { spawnSync } = require("child_process");
const iconv = require("iconv-lite");
const workerpool = require("workerpool");
const path = require("path");
const fs = require("fs-extra");
const log = require("./lib/debug");
const h = require("./lib/helper");
const cue = require("./lib/cue");
const chalk = require("chalk");

function executeCommand(command, args = []) {
  const argsStr = args.join(" ");
  const result = spawnSync(command, args);
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

function getFFmpegArgs(track) {
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
  args = args.concat("-map a:0 -c:a libfdk_aac -b:a 320k".split(" "));
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
  log.debug(`Processing(${i}):`, file.path, options);
  options = options || {};
  options.logLevel && log.setLevel(options.logLevel);
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
    const ta = getFFmpegArgs(track);
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

// convert one mp3/ape/wav/flac to single aac file
function convertAudio(file, i, options) {
  log.debug(`Processing(${i}):`, file.path, options);
  options = options || {};
  options.logLevel && log.setLevel(options.logLevel);
  // ls *.mp3 | parallel ffmpeg -n -loglevel repeat+level+warning -i "{}" -map a:0 -c:a libfdk_aac -b:a 192k output/"{.}".m4a -hide_banner
  const fileSrc = path.resolve(file.path);
  const [dir, base, ext] = h.pathSplit(fileSrc);
  const dstDir = dir;
  const fileDst = path.join(dstDir, `${base}.m4a`);
  if (fs.pathExistsSync(fileDst)) {
    log.warn(`SkipExists(${i}):`, fileDst);
    return { status: 0, output: "", file: fileSrc };
  }
  let args = "-n -loglevel repeat+level+info -i".split(" ");
  args.push(fileSrc);
  args = args.concat("-map a:0 -c:a libfdk_aac -b:a".split(" "));
  if (file.loseless || file.bitRate > 320) {
    args.push("320k");
  } else {
    args.push(file.bitRate > 192 ? "192k" : "128k");
  }
  args.push(fileDst);
  args.push("-hide_banner");
  log.debug(i, "ffmpeg", args);
  fs.ensureDirSync(dstDir);
  log.show(`Converting(${i}):`, fileSrc, file.bitRate);
  const result = executeCommand("ffmpeg", args);
  if (result.status == 0) {
    log.showGreen(`Converted(${i}):`, fileDst);
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
    d.error(`Error(${i}):`, fileSrc, result.output);
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
