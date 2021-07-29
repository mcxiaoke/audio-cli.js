#!/usr/bin/env node
const path = require("path");
const fs = require("fs-extra");
const h = require("helper");
const d = require("debug");
const un = require("unicode");
const chardet = require("chardet");
const parser = require("better-cue-parser");
const printf = require("printf");

const encodingChoices = ["gb18030", "gbk", "gb2312", "utf8", "utf-8"];

function getAudioFile(cuefile) {
  d.I(`parseAudioTracks: ${h.ps(cuefile)}`);
  cuefile = path.resolve(cuefile);
  const [dir, base, ext] = h.pathSplit(cuefile);
  if (!ext || ext.toLowerCase() != ".cue") {
    d.W(`parseAudioTracks Error:${h.ps(cuefile)} is not a valid cue file`);
    return;
  }
  const data = fs.readFileSync(cuefile);
  let encoding = chardet.detectFileSync(cuefile);
  if (!encodingChoices.includes(encoding.toLowerCase())) {
    encoding = "gbk";
  }
  let sheet;
  try {
    sheet = parser.parse(data, encoding);
  } catch (error) {
    sheet = parser.parse(data, "utf8");
  }
  if (!sheet || !sheet.files || sheet.files.length == 0) {
    d.W(`parseAudioTracks Error:${h.ps(cuefile)} has no valid tracks`);
    return;
  }
  let sheetFile = path.join(path.dirname(cuefile), sheet.files[0].name);
  let fileChoices = h.AUDIO_LOSELESS.map((aExt) =>
    path.join(dir, `${base}${aExt}`)
  );
  fileChoices.unshift(sheetFile);
  for (const fc of fileChoices) {
    if (fs.pathExistsSync(fc)) {
      return fc;
    }
  }
}

function parseAudioTracks(cuefile) {
  d.I(`parseAudioTracks: ${h.ps(cuefile)}`);
  cuefile = path.resolve(cuefile);
  const [dir, base, ext] = h.pathSplit(cuefile);
  if (!ext || ext.toLowerCase() != ".cue") {
    d.W(`parseAudioTracks Error:${h.ps(cuefile)} is not a valid cue file`);
    return;
  }
  // only support single file cue sheet
  const data = fs.readFileSync(cuefile);
  // const encoding = process.platform.includes("win") ? "gbk" : "utf8";
  let encoding = chardet.detectFileSync(cuefile);
  if (!encodingChoices.includes(encoding.toLowerCase())) {
    encoding = "gbk";
  }
  d.I(`parseAudioTracks: ${encoding} ${h.ps(cuefile)}`);
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
    d.W(`parseAudioTracks Error:${h.ps(cuefile)} has no valid tracks`);
    return;
  }
  // d.D(sheet);
  let sheetFile = path.join(path.dirname(cuefile), sheet.files[0].name);
  let fileChoices = h.AUDIO_LOSELESS.map((aExt) =>
    path.join(dir, `${base}${aExt}`)
  );
  fileChoices.unshift(sheetFile);
  let file;
  // find matched audio file for cue
  for (const fc of fileChoices) {
    if (fs.pathExistsSync(fc)) {
      file = fc;
      break;
    }
  }

  if (!file) {
    {
      d.W(`parseAudioTracks Error:${cuefile} has no matched audio file`);
      return;
    }
  }

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
    d.D(track);
    artist = artist.replace(/[?!"']/g, "");
    // filter invalid chars in artist
    artist = artist.split(/[\\/]/)[0].trim();
    let title = track.title.replace(/[?!"']/g, "");
    title = title.split(/[\\/]/)[0].trim();
    clips.push({
      file: file,
      title: title,
      artist: artist,
      album: sheet.title.trim(),
      index: track.number,
      ss: ss,
      to: to,
    });
  }
  d.I(`Found Tracks for ${h.ps(cuefile)}:`);
  for (const c of clips) {
    d.I(
      `Found Track ${c.index}: ${c.artist} @ ${c.title} (${c.album}) ${c.index} -ss:${c.ss} -to ${c.to}`
    );
  }
  return clips;
}

// d.setLevel(9);
module.exports.parseAudioTracks = parseAudioTracks;
module.exports.getAudioFile = getAudioFile;
