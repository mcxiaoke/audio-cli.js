// 从"child_process"模块导入spawnSync函数
const { spawnSync } = require("child_process");
// 导入iconv-lite模块，用于编码转换
const iconv = require("iconv-lite");
// 导入workerpool模块，用于创建Worker线程池
const workerpool = require("workerpool");
// 导入path模块，用于处理文件路径
const path = require("path");
// 导入fs-extra模块，用于文件操作
const fs = require("fs-extra");
// 导入自定义的日志库
const log = require("./lib/debug");
// 导入辅助库
const h = require("./lib/helper");
// 导入CUE处理库
const cue = require("./lib/cue");

/**
 * 执行命令行命令，并返回执行结果
 * @param {string} command - 需要执行的命令
 * @param {Array} args - 命令行参数数组
 * @returns {Object} 包含命令执行状态和输出的对象
 */
function executeCommand(command, args = []) {
  const argsStr = args.join(" "); // 将参数数组转换为字符串
  const result = spawnSync(command, args); // 执行命令
  log.info(command, argsStr); // 记录命令执行信息
  let output;
  if (result.status != 0) { // 命令执行失败
    output = iconv.decode(result.stderr, "utf8"); // 从标准错误中获取输出
    log.error(
      "executeCommand",
      command,
      argsStr,
      result.status,
      output,
      process.pid
    ); // 记录错误信息
  } else { // 命令执行成功
    output = iconv.decode(result.stdout, "utf8"); // 从标准输出中获取输出
    log.debug("executeCommand", command, argsStr, output, process.pid); // 记录调试信息
  }
  return {
    command: command,
    args: args,
    status: result.status,
    ok: result.status == 0,
    output: output,
  };
}

/**
 * 使用exiftool命令行工具获取文件的元数据
 * @param {string} file - 文件路径
 * @returns {Object} 文件的元数据
 */
function cmdExifTool(file) {
  const result = spawnSync("exiftool", ["-j", file]); // 执行exiftool命令
  try {
    return JSON.parse(iconv.decode(result.stdout, "utf8"))[0]; // 解析命令输出
  } catch (error) {
    log.error("cmdExifTool", error, file); // 处理解析错误
  }
}

/**
 * 使用ffprobe命令行工具获取文件的媒体信息
 * @param {string} file - 文件路径
 * @returns {Object} 文件的媒体信息
 */
function cmdFFProbe(file) {
  const args =
    "-hide_banner -loglevel fatal -show_error -show_format -show_streams -show_programs -show_chapters -print_format json".split(
      " "
    );
  const result = spawnSync("ffprobe", args); // 执行ffprobe命令
  try {
    return JSON.parse(iconv.decode(result.stdout, "utf8"))[0]; // 解析命令输出
  } catch (error) {
    log.error("cmdFFProbe", error, file); // 处理解析错误
  }
}

/**
 * 生成ffmpeg转换轨道所需的参数数组
 * @param {Object} track - 轨道信息对象
 * @param {Object} options - 转换选项对象
 * @returns {Object} 包含目标文件路径、索引和ffmpeg参数数组的对象
 */
function getFFmpegArgs(track, options) {
  const fileSrc = track.file; // 输入文件路径
  log.debug("getFFmpegArgs input:", fileSrc);
  const dstDir = path.dirname(fileSrc); // 输出文件目录
  const dstName = `${track.artist} @ ${track.title}.m4a`; // 输出文件名
  const fileDst = path.join(dstDir, dstName); // 完整的输出文件路径
  let args = "-loglevel repeat+level+debug".split(" "); // 初始化ffmpeg参数
  if (track.ss) {
    args.push("-ss");
    args.push(track.ss); // 添加开始时间
  }
  if (track.to) {
    args.push("-to");
    args.push(track.to); // 添加结束时间
  }
  args.push("-i");
  args.push(`${fileSrc}`); // 添加输入文件路径
  // 插入元数据
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
  // 结束插入元数据
  // 选择aac编码器（如果支持则使用libfdk_aac）
  args = args.concat(
    `-map a:0 -c:a ${options.useLibfdkAAC ? "libfdk_aac" : "aac"
      } -b:a 320k`.split(" ")
  );
  args.push(`${fileDst}`); // 输出文件路径
  args.push("-hide_banner"); // 隐藏ffmpeg启动横幅
  log.debug("getFFmpegArgs", "ffmpeg", args);
  return {
    fileDst: fileDst,
    index: track.index,
    args: args,
  };
}

/**
 * 将一个APE/WAV/FLAC文件根据CUE信息拆分为多个AAC轨道
 * @param {Object} file - 源文件信息对象
 * @param {number} i - 当前处理文件的索引
 * @param {Object} options - 转换选项对象
 * @returns {Object} 包含处理结果的物体，包括跳过的文件、失败的文件和成功的文件
 */
function splitTracks(file, i, options) {
  options = options || {};
  options.logLevel && log.setLevel(options.logLevel); // 设置日志级别
  log.info(`Processing(${i}):`, file.path, options);
  const fileSrc = path.resolve(file.path); // 解析源文件的完整路径
  const audioName = path.basename(file.audio); // 获取音频文件名

  let tracks;
  try {
    tracks = cue.parseAudioTracks(file); // 解析CUE信息
  } catch (error) {
    tracks = null;
    log.error(`splitTracks(${i}):`, i, error, fileSrc); // 处理解析错误
  }
  if (!tracks || tracks.length == 0) {
    log.warn("splitTracks(${i}):", "no tracks found", fileSrc); // 警告未找到轨道
    return {
      file: file,
      skipped: [],
      failed: [{ file: fileSrc, error: "Failed to parse cue" }], // 标记解析失败
    };
  }

  const failed = []; // 存储失败的轨道
  const skipped = []; // 存储跳过的轨道
  for (const track of tracks) {
    const ta = getFFmpegArgs(track, options); // 获取ffmpeg参数
    log.debug(
      "splitTracks Begin:",
      `${file.audio} Track-${ta.index}:`,
      path.basename(ta.fileDst)
    );
    if (fs.pathExistsSync(ta.fileDst)) {
      skipped.push({ file: ta.fileDst }); // 跳过已存在的输出文件
      log.info(
        "splitTracks Skip:",
        `${file.audio} Track-${ta.index}:`,
        path.basename(ta.fileDst)
      );
      continue;
    }
    const r = executeCommand("ffmpeg", ta.args); // 执行ffmpeg命令
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
      failed.push({ file: ta.fileDst, error: r.output }); // 标记失败的轨道
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

/**
 * 转换音频文件的函数。
 * @param {Object} file - 包含音频文件路径和目标路径等信息的对象。
 * @param {number} i - 当前处理文件的索引。
 * @param {number} total - 需要处理的文件总数。
 * @param {Object} options - 可选参数，例如日志级别和编码选项。
 * @returns {Object} 返回一个包含状态码、输出信息和文件路径的对象。
 */
function convertAudio(file, i, total, options = {}) {
  // 设置日志记录级别
  options.logLevel && log.setLevel(options.logLevel);
  log.info(`Processing(${i}):`, file.path, options);

  // 初始化源文件全路径
  const fileSrc = path.resolve(file.path);

  // 检查目标目录是否存在，不存在则创建
  if (!fs.pathExistsSync(file.dstDir)) {
    fs.mkdirpSync(file.dstDir);
  }

  // 检查目标文件是否已存在，若存在则跳过转换
  if (fs.pathExistsSync(file.fileDst)) {
    log.warn(`SkipExists1(${i}):`, fileDst);
    return { status: 0, output: "", file: fileSrc };
  }
  if (fs.pathExistsSync(file.fileDstSameDir)) {
    log.warn(`SkipExists2(${i}):`, file.fileDstSameDir);
    return { status: 0, output: "", file: file.fileDstSameDir };
  }

  // 初始化并配置ffmpeg命令行参数
  let args = "-hide_banner -n -loglevel repeat+level+info -i".split(" ");
  args.push(fileSrc); // 添加源文件路径

  // 添加音频编码参数
  args = args.concat(
    `-map a:0 -c:a ${options.useLibfdkAAC ? "libfdk_aac" : "aac"} -b:a`.split(
      " "
    )
  );

  args.push(file.quality);
  // args.push("-f mp4");
  args.push(file.fileDstTemp); // 添加临时目标文件路径

  // 记录调试信息和确保输出目录存在
  log.debug(i, "ffmpeg", args);
  fs.ensureDirSync(file.dstDir);

  // 开始转换过程的日志记录
  log.show(`Converting(${i}/${total}):`, h.ps(fileSrc), file.lossless, h.ht(options.startMs));
  log.info(`Converting(${i}/${total}):`, args);

  // 执行ffmpeg命令进行音频转换
  const result = executeCommand("ffmpeg", args);

  // 根据转换结果进行处理，成功则移动文件，失败则删除临时文件
  if (result.status == 0) {
    fs.renameSync(file.fileDstTemp, file.fileDst);
    log.showGreen(`Converted(${i}/${total}):${h.ps(file.fileDst)} ${file.quality}`);
  } else {
    fs.removeSync(file.fileDstTemp);
    log.error(`Error(${i}):`, fileSrc, result.output.substring(0, 60));
  }

  return result;
}

// 配置workerpool以使用指定的命令和工作函数
workerpool.worker({
  cmdExifTool,
  cmdFFProbe,
  convertAudio,
  splitTracks,
});
