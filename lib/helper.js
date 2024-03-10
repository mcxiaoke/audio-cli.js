const path = require("path");
const fs = require("fs-extra");

const AUDIO_FORMATS = [
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".wma",
  ".ape",
  ".flac",
  ".tta",
  ".dts",
  ".vox",
  ".wav",
];

const AUDIO_LOSELESS = [".ape", ".flac", ".wav", ".tta", ".dts"];

// https://stackoverflow.com/questions/1144783/
// simple: str.split(search).join(replacement)
// or str = str.replace(/abc/g, '');
// function replaceAll(str, find, replace) {
//   return str.replace(new RegExp(find, 'g'), replace);
// }
function escapeRegExp(string) {
  return string.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&");
  // $& means the whole matched string
}
function replaceAll(str, find, replace) {
  return str.replace(new RegExp(escapeRegExp(find), "g"), replace);
}

function humanTime(startMs) {
  // TIP: to find current time in milliseconds, use:
  // var  current_time_milliseconds = new Date().getTime();
  function numberEnding(number) {
    return number > 1 ? "s" : "";
  }
  var milliseconds = Date.now() - startMs;
  var temp = Math.floor(milliseconds / 1000);
  var years = Math.floor(temp / 31536000);
  if (years) {
    return years + " year" + numberEnding(years);
  }
  //TODO: Months! Maybe weeks?
  var days = Math.floor((temp %= 31536000) / 86400);
  if (days) {
    return days + " day" + numberEnding(days);
  }
  var hours = Math.floor((temp %= 86400) / 3600);
  if (hours) {
    return hours + " hour" + numberEnding(hours);
  }
  var minutes = Math.floor((temp %= 3600) / 60);
  if (minutes) {
    return minutes + " minute" + numberEnding(minutes);
  }
  var seconds = temp % 60;
  if (seconds) {
    return seconds + " second" + numberEnding(seconds);
  }
  return milliseconds + " ms";
}

// https://stackoverflow.com/questions/10420352/
function fileSizeSI(a, b, c, d, e) {
  return (
    ((b = Math),
      (c = b.log),
      (d = 1e3),
      (e = (c(a) / c(d)) | 0),
      a / b.pow(d, e)).toFixed(2) +
    " " +
    (e ? "kMGTPEZY"[--e] + "B" : "Bytes")
  );
}

function pathShort(s, width = 45) {
  // shorten long path by segments
  if (!s || s.length < width) {
    return s;
  }
  let parts = s.split(path.sep);
  if (parts.length < 4) {
    return s;
  }
  let length = 0;
  let index = 0;
  for (let i = 0; i < parts.length; i++) {
    length += parts[i].length;
    index = i;
    if (s.length - length < width) {
      break;
    }
  }
  // console.log(parts, s.length, length, index);
  return path.join("...", ...parts.slice(index));
}

function pathSplit(fullpath) {
  abspath = path.resolve(fullpath);
  filename = path.basename(abspath);
  d = path.dirname(abspath);
  e = path.extname(abspath);
  b = path.basename(filename, e);
  // dir,base,ext
  return [d, b, e];
}

function pathExt(filename, toLowerCase = false) {
  const ext = path.extname(filename);
  return toLowerCase ? ext && ext.toLowerCase() : ext;
}

/**
 * 去掉输入路径的根目录，组合输出目录，生成新路径
 * 假设输入 'F:\\Temp\\JPEG\\202206\\DSCN2040.JPG'
 * 假设输出 'E:\\Temp\Test\\'
 * 那么结果 'E:\\Temp\\Test\\Temp\\JPEG\\202206\\DSCN2040_thumb.jpg'
 * @param {*} input 输入路径
 * @param {*} output 输出路径
 * @returns 生成新路径
 */
function pathRewrite(input, output) {
  let segs = input.split(path.sep)
  segs = segs.slice(Math.max(1, segs.length - 3))
  return path.join(output, ...segs)
}

function isAudioFile(filename) {
  return AUDIO_FORMATS.includes(pathExt(filename, true));
}

function isLosslessAudio(filename) {
  return AUDIO_LOSELESS.includes(pathExt(filename, true));
}

function getAACFileName(filename) {
  const ext = pathExt(filename);
  const base = path.basename(filename, ext);
  return base + ".m4a";
}

module.exports.isAudioFile = isAudioFile;
module.exports.isLosslessAudio = isLosslessAudio;
module.exports.ext = pathExt;
module.exports.ps = pathShort;
module.exports.pathRewrite = pathRewrite;
module.exports.fz = fileSizeSI;
module.exports.ht = humanTime;
module.exports.replaceAll = replaceAll;
module.exports.pathSplit = pathSplit;
module.exports.getAACFileName = getAACFileName;
module.exports.AUDIO_LOSELESS = AUDIO_LOSELESS;
