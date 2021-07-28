#!/usr/bin/env node
const os = require("os");
const klawSync = require("klaw-sync");
const ExifTool = require("exiftool-vendored").ExifTool;
const h = require("./helper");
const d = require("./debug");
const et = new ExifTool({
  taskTimeoutMillis: 5000,
  maxTasksPerProcess: 1000,
  maxProcs: os.cpus().length,
  exiftoolPath: "exiftool",
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

function listFiles(root, filterFn) {
  // list all files in root dir, exclude small files
  let startMs = Date.now();
  let files = klawSync(root, {
    nodir: true,
    traverseAll: true,
    filter: filterFn,
  });
  files = files.map((f) => {
    f.root = root;
    return f;
  });
  d.I(`listFiles: ${files.length} files found in ${h.ht(startMs)}`);
  return files;
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

module.exports.listFiles = listFiles;
module.exports.readTags = readTags;
module.exports.readAllTags = readAllTags;
