#!/usr/bin/env node
const util = require("util");
const path = require("path");
const os = require("os");
const klawSync = require("klaw-sync");
// https://www.npmjs.com/package/music-metadata
const mm = require("music-metadata");
// https://www.npmjs.com/package/node-id3
const nd = require("node-id3").Promise;
// https://www.npmjs.com/package/jsmediatags
const jm = require("jsmediatags");
// https://www.npmjs.com/package/exiftool-vendored
const ExifTool = require("exiftool-vendored").ExifTool;
const et = new ExifTool({
  taskTimeoutMillis: 5000,
  maxTasksPerProcess: 1000,
  maxProcs: os.cpus().length - 1,
});

const AUDIO_FORMATS = [
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".wma",
  ".ape",
  ".flac",
  ".tta",
  ".vox",
  ".wav",
];

function isAudioFile(filename) {
  return AUDIO_FORMATS.includes(pathExt(filename, true));
}

function pathExt(filename) {
  const ext = path.extname(filename);
  return ext && ext.toLowerCase();
}

function listFiles(root) {
  const files = klawSync(root, { nodir: true, traverseAll: true });
  console.log("listFiles", files.length);
  return files.map((f) => f.path).filter((f) => isAudioFile(f));
}

function selectID3(mt) {
  if (!mt.format.tagTypes || mt.format.tagTypes.length == 0) {
    return;
  }
  for (const type of mt.format.tagTypes) {
    if (type !== "ID3v1") {
      return [type, mt.native[type]];
    }
  }
}

async function useMusicMetaData(files) {
  console.log("useMusicMetaData");
  const start = Date.now();
  const results = [];
  for (const [i, f] of files.entries()) {
    let tags;
    try {
      const mt = await mm.parseFile(f, { skipCovers: true });
      //   console.log(i, f, mt.format.tagTypes, selectID3(mt), mt.common);
      if (!mt.format.tagTypes || mt.format.tagTypes.length == 0) {
        console.log("useMusicMetaData error", i, f, "no tags found");
      }
    } catch (error) {
      console.error("useMusicMetaData error", i, f, String(error));
      tags = {};
    }
    results.push(tags);
  }
  const elapsed = Date.now() - start;
  console.log(`useMusicMetaData ${files.length} files parsed in ${elapsed}ms`);
  // useMusicMetaData 5385 files parsed in 4964ms
  // useMusicMetaData 31245 files parsed in 1334s on network shared hdd
  // fastest id3 parse lib
  return elapsed;
}

async function useExifTool(files) {
  console.log("useExifTool");
  const start = Date.now();
  const results = await Promise.all(
    files.map(async (f, i) => {
      let tags;
      try {
        // console.log("useExifTool", i, f);
        tags = await et.read(f);
        // console.log(tags);
      } catch (error) {
        console.error("useExifTool", i, error, f);
        tabs = {};
      }
      return tags;
    })
  );
  await et.end();
  const elapsed = Date.now() - start;
  console.log(`useExifTool ${files.length} files parsed in ${elapsed}ms`);
  // for-of useExifTool 5385 files parsed in 103051ms
  // map-async useExifTool 5385 files parsed in 16251ms
  return elapsed;
}

async function useNodeID3(files) {
  console.log("useNodeID3");
  const start = Date.now();
  for (const [i, f] of files.entries()) {
    try {
      //   console.log("useNodeID3", i, f);
      const tags = await nd.read(f);
      //   console.log(util.inspect(tags, { showHidden: false, depth: null }));
    } catch (error) {
      console.error("useNodeID3", i, String(error), f);
    }
  }
  const elapsed = Date.now() - start;
  console.log(`useNodeID3 ${files.length} files parsed in ${elapsed}ms`);
  // useNodeID3 5385 files parsed in 46906ms
  // and many files can not parsed
  // too bad
  return elapsed;
}

async function jmRead(file) {
  return new Promise((resolve, reject) => {
    jm.read(file, {
      onSuccess: resolve,
      onError: reject,
    });
  });
}

async function useJSMediaTags(files) {
  console.log("useJSMediaTags");
  const start = Date.now();
  for (const [i, f] of files.entries()) {
    try {
      //   console.log("useJSMediaTags", i, f);
      const tags = await jmRead(f);
      //   console.log(util.inspect(tags, { showHidden: false, depth: null }));
    } catch (error) {
      console.error("useJSMediaTags", i, error, f);
    }
  }
  const elapsed = Date.now() - start;
  console.log(`useJSMediaTags ${files.length} files parsed in ${elapsed}ms`);
  // useJSMediaTags 5385 files parsed in 70524ms
  // too slow
  return elapsed;
}

async function main() {
  const root = process.argv.slice(2)[0];
  console.log(root);
  const files = listFiles(root);
  await useMusicMetaData(files);
  //   await useExifTool(files);
  //   await useNodeID3(files);
  //   await useJSMediaTags(files);
}

main();
