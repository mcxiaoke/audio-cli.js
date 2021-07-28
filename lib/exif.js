#!/usr/bin/env node
const os = require("os");
const ExifTool = require("exiftool-vendored").ExifTool;
const h = require("./helper");
const d = require("./debug");
const et = new ExifTool({
  taskTimeoutMillis: 5000,
  maxTasksPerProcess: 1000,
  maxProcs: os.cpus().length,
});

async function readTags(filename) {
  try {
    return await et.read(filename);
  } catch (error) {
    d.E(error);
  } finally {
    await et.end();
  }
}

async function readAllTags(files) {
  // files => file list
  // or files => root
  // if (typeof files == "string") {
  //   files = listFiles(files);
  // }
  const t = files.length;
  let startMs = Date.now();
  files = await Promise.all(
    files.map(async (f, i) => {
      const filename = f.path;
      try {
        const tags = await et.read(filename);
        // show exiftool error message
        if (tags.Error) {
          d.E(`readAllTags: err ${h.ps(filename)} ${error}`);
        }
        d.I(`readAllTags: ${i}/${t} ${h.ps(filename)}`);
        f.tags = tags;
      } catch (error) {
        d.E(`readAllTags: catch ${h.ps(filename)} ${error}`);
      }
      return f;
    })
  );
  await et.end();
  d.L(`readAllTags: ${files.length} files processed in ${h.ht(startMs)}`);
  return files.filter((f) => f.tags);
}

module.exports.readTags = readTags;
module.exports.readAllTags = readAllTags;
