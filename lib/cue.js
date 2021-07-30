#!/usr/bin/env node
const path = require("path");
const fs = require("fs-extra");
const chardet = require("chardet");
const parser = require("better-cue-parser");
const printf = require("printf");
const log = require("./debug");
const h = require("./helper");

const encodingChoices = ["gb18030", "gbk", "gb2312", "utf8", "utf-8"];

async function findAudioFile(cuefile) {
  log.info("findAudioFile", cuefile);
  cuefile = path.resolve(cuefile);
  const [dir, base, ext] = h.pathSplit(cuefile);
  if (!ext || ext.toLowerCase() != ".cue") {
    log.warn("findAudioFile", `not a valid cue`, cuefile);
    return;
  }
  const data = await fs.readFile(cuefile);
  let encoding = await chardet.detectFile(cuefile);
  if (!encodingChoices.includes(encoding.toLowerCase())) {
    encoding = "gbk";
  }
  log.debug("findAudioFile encoding", encoding, cuefile);
  let sheet;
  try {
    sheet = parser.parse(data, encoding);
  } catch (error) {
    sheet = parser.parse(data, "utf8");
  }
  if (!sheet || !sheet.files || sheet.files.length == 0) {
    log.warn("findAudioFile", "no valid tracks", cuefile);
    return;
  }
  let sheetFile = path.join(path.dirname(cuefile), sheet.files[0].name);
  let fileChoices = h.AUDIO_LOSELESS.map((aExt) =>
    path.join(dir, `${base}${aExt}`)
  );
  fileChoices.unshift(sheetFile);
  for (const fc of fileChoices) {
    if (fs.pathExistsSync(fc)) {
      return { path: cuefile, audio: fc };
    }
  }
}

function parseAudioTracks(file) {
  const cuefile = path.resolve(file.path);
  log.info(`parseAudioTracks`, cuefile);
  if (h.ext(cuefile, true) != ".cue") {
    log.warn("parseAudioTracks", "not valid cue", cuefile);
    return;
  }
  // only support single file cue sheet
  const data = fs.readFileSync(cuefile);
  // const encoding = process.platform.includes("win") ? "gbk" : "utf8";
  let encoding = chardet.detectFileSync(cuefile);
  if (!encodingChoices.includes(encoding.toLowerCase())) {
    encoding = "gbk";
  }
  log.debug("parseAudioTracks", encoding, cuefile);
  let sheet;
  try {
    sheet = parser.parse(data, encoding);
  } catch (error) {
    sheet = parser.parse(data, "utf8");
  }
  if (
    !sheet ||
    !sheet.files ||
    sheet.files.length == 0 ||
    !sheet.files[0].tracks ||
    sheet.files[0].tracks.length == 0
  ) {
    log.warn("parseAudioTracks", "no valid tracks", cuefile);
    return;
  }
  log.debug("parseAudioTracks", sheet);
  const tracks = sheet.files[0].tracks;
  const clips = [];
  const format = "%02d:%02d:%02d.%02d";
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const curTS =
      track.indexes.length > 1 ? track.indexes[1].time : track.indexes[0].time;
    const ss = printf(
      format,
      curTS.min / 60,
      curTS.min % 60,
      curTS.sec,
      curTS.frame
    );
    let nextTS;
    if (i == 0) {
      nextTS = tracks[i + 1].indexes[0].time;
    } else if (i + 1 < tracks.length) {
      const nt0 = tracks[i + 1].indexes[0].time;

      if (tracks[i + 1].indexes.length == 1) {
        // fix some only has index 0
        nextTS = nt0;
      } else {
        const nt1 = tracks[i + 1].indexes[1].time;
        // fix some invalid INDEX 0 timestamp
        nextTS = nt0.min < nt1.min ? nt1 : nt0;
      }
    }
    const to =
      nextTS &&
      printf(
        format,
        nextTS.min / 60,
        nextTS.min % 60,
        nextTS.sec,
        nextTS.frame
      );
    if (nextTS && curTS) {
      if (nextTS.min * 60 + nextTS.sec < curTS.min * 60 + curTS.sec) {
        // invalid timestamp/duration, throw error
        throw `Invalid timestamp for track:${track.number} ${track.title} of ${cuefile}`;
      }
    }
    let artist = track.performer || sheet.performer || "Unknown";
    log.debug("parseAudioTracks", cuefile, track);
    artist = artist.replace(/[?!"']/g, "");
    // filter invalid chars in artist
    artist = artist.split(/[\\/]/)[0].trim();
    let title = track.title.replace(/[?!"']/g, "");
    title = title.split(/[\\/]/)[0].trim();
    clips.push({
      file: file.audio,
      title: title,
      artist: artist,
      album: sheet.title.trim(),
      index: track.number,
      ss: ss,
      to: to,
    });
  }

  for (const [i, c] of clips.entries()) {
    log.debug(`parseAudioTracks track-${i}:`, c);
  }
  log.info(
    "parseAudioTracks",
    `Found ${clips.length} tracks for ${h.ps(cuefile)}:`
  );
  return clips;
}

module.exports.parseAudioTracks = parseAudioTracks;
module.exports.findAudioFile = findAudioFile;
