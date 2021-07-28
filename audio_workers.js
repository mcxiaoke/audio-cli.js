const { spawnSync } = require("child_process");
const iconv = require("iconv-lite");
const workerpool = require("workerpool");
const path = require("path");
const fs = require("fs-extra");
const d = require("./lib/debug");
const h = require("./lib/helper");
const cue = require("./lib/cue");
const chalk = require("chalk");

function executeCommand(command, args = []) {
  const argsStr = args.join(" ");
  const result = spawnSync(command, args);
  let output;
  if (result.status != 0) {
    output = iconv.decode(result.stderr, "utf8");
    d.W(
      chalk.red(
        `Command Failed: '${command} ${argsStr}' (${result.status}):${output} (${process.pid})`
      )
    );
  } else {
    output = iconv.decode(result.stdout, "utf8");
    d.D(`Command Success: '${command} ${argsStr}' (${process.pid})`);
  }
  output && d.D(`Execute Command output: ${output}`);
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
    d.E(`ERROR! cmdExifTool ${error} <${file}>`);
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
    d.E(`ERROR! cmdFFProbe ${error} <${file}>`);
  }
}

function getTrackArgs(track) {
  const fileSrc = track.file;
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
  d.D("getTrackArgs", "ffmpeg", args);
  return {
    fileDst: fileDst,
    index: track.index,
    args: args,
  };
}

// convert one ape/wav/flac file with cue to multi aac tracks
function splitTracks(file, index) {
  // ffmpeg -ss 00:00:00.00 -to 00:04:34.35 -i .\女生宿舍.ape -map a:0 -c:a libfdk_aac -b:a 320k -metadata title="恋人未满" -metadata artist="S.H.E" -metadata album="女生宿舍" track01.m4a
  const fileSrc = path.resolve(file.path);
  d.L(`splitTracks: ${h.ps(fileSrc)} (${index})`);
  let tracks;
  try {
    tracks = cue.parseAudioTracks(fileSrc);
  } catch (error) {
    tracks = null;
    d.W(chalk.red(`splitTracks: ${fileSrc} (${index}) ${error}`));
  }
  if (!tracks || tracks.length == 0) {
    d.W(chalk.yellow(`splitTracks: no tracks found for ${fileSrc} (${index})`));
    return {
      file: fileSrc,
      skipped: [],
      failed: [{ file: fileSrc, error: "Failed to parse cue" }],
    };
  }

  const failed = [];
  const skipped = [];
  for (const track of tracks) {
    const ta = getTrackArgs(track);
    d.I(`Track (${track.index}): to ${h.ps(ta.fileDst)}`);
    if (fs.pathExistsSync(ta.fileDst)) {
      d.I(chalk.gray(`Skip Track: ${h.ps(ta.fileDst)} (${ta.index})`));
      skipped.push({ file: ta.fileDst });
      continue;
    }
    const r = executeCommand("ffmpeg", ta.args);
    if (r.status == 0) {
      d.L(chalk.green(`Track(${track.index}) saved to ${h.ps(ta.fileDst)}`));
    } else {
      d.W(
        chalk.yellow(
          `Track(${track.index}) ${h.ps(ta.fileDst)} Error:${r.output}`
        )
      );
      failed.push({ file: ta.fileDst, error: r.output });
    }
  }
  if (failed.length == 0) {
    d.L(chalk.green(`All OK (${index}): ${h.ps(fileSrc)}`));
  } else {
    d.W(`Some OK (${index}): ${h.ps(fileSrc)} ${failed.length} failed`);
  }
  const r = {
    file: fileSrc,
    failed: failed,
    skipped: skipped,
  };
  return r;
}

// convert one mp3/ape/wav/flac to single aac file
function toAACFile(file, index) {
  // ls *.mp3 | parallel ffmpeg -n -loglevel repeat+level+warning -i "{}" -map a:0 -c:a libfdk_aac -b:a 192k output/"{.}".m4a -hide_banner
  d.D(`toAACFile: processing ${index} ${file.path}`);
  const fileSrc = path.resolve(file.path);
  const [dir, base, ext] = h.pathSplit(fileSrc);
  const dstDir = dir;
  const fileDst = path.join(dstDir, `${base}.m4a`);
  if (fs.pathExistsSync(fileDst)) {
    d.W(`SkipExists: ${h.ps(fileDst)} (${index})`);
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
  d.I("ffmpeg", args);
  // console.log(`Converting: ${fileName}`);
  fs.ensureDirSync(dstDir);
  // const result = spawnSync("ffmpeg", args);
  d.L(chalk.gray(`Converting (${index}): [${file.bitRate}k] ${h.ps(fileSrc)}`));
  const result = executeCommand("ffmpeg", args);
  if (result.status == 0) {
    d.L(chalk.green(`Converted OK (${index}): ${h.ps(fileDst)}`));
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
    d.W(chalk.yellow(`ERROR (${index}): ${h.ps(fileSrc)} ${result.output}`));
  }
  return result;
}

// https://github.com/josdejong/workerpool
// https://www.npmjs.com/package/workerpool
workerpool.worker({
  cmdExifTool: cmdExifTool,
  cmdFFProbe: cmdFFProbe,
  toAACFile: toAACFile,
  splitTracks: splitTracks,
});
