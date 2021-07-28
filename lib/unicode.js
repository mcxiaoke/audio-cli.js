const REGEX_ASCII_ONLY = /^[\x00-\x7F]*$/; // or es2018: /^[\p{ASCII}]+$/u
const strOnlyASCII = (str) => REGEX_ASCII_ONLY.test(str);

const REGEX_ASCII_ANY = /[\x00-\x7F]/;
const strHasASCII = (str) => REGEX_ASCII_ANY.test(str);

const REGEX_JAPANESE =
  /[\u3000-\u303f]|[\u3040-\u309f]|[\u30a0-\u30ff]|[\uff00-\uff9f]|[\u4e00-\u9faf]|[\u3400-\u4dbf]/;
const strHasJapanese = (str) => REGEX_JAPANESE.test(str);

const REGEX_CHINESE =
  /[\u4e00-\u9fff]|[\u3400-\u4dbf]|[\u{20000}-\u{2a6df}]|[\u{2a700}-\u{2b73f}]|[\u{2b740}-\u{2b81f}]|[\u{2b820}-\u{2ceaf}]|[\uf900-\ufaff]|[\u3300-\u33ff]|[\ufe30-\ufe4f]|[\uf900-\ufaff]|[\u{2f800}-\u{2fa1f}]/u;
const strHasChinese = (str) => REGEX_CHINESE.test(str);

// Hani 汉字;  Common 公用符号
// Hang Hangul 朝鲜彦文; Hira 平假名; Kana 片假名;
const REGEX_UNICODE_HAN_ANY = /[\p{sc=Hani}]/u;
const strHasHani = (str) => REGEX_UNICODE_HAN_ANY.test(str);
const REGEX_UNICODE_HAN_ONLY = /^[\p{sc=Hani}]+$/u;
const strOnlyHani = (str) => REGEX_UNICODE_HAN_ONLY.test(str);

const REGEX_HAS_HIRA_OR_KANA = /[\p{sc=Hira}]|[\p{sc=Kana}]/u;
const strHasHiraKana = (str) => REGEX_HAS_HIRA_OR_KANA.test(str);

const REGEX_ONLY_HIRA_OR_KANA = /^[\p{sc=Hira}]|[\p{sc=Kana}]+$/u;
const strOnlyHiraKana = (str) => REGEX_ONLY_HIRA_OR_KANA.test(str);

const REGEX_HAS_HANGUL = /[\p{sc=Hang}]/u;
const strHasHangul = (str) => REGEX_HAS_HANGUL.test(str);
const REGEX_ONLY_HANGUL = /^[\p{sc=Hang}]+$/u;
const strOnlyHangul = (str) => REGEX_ONLY_HANGUL.test(str);

// https://zh.wikipedia.org/wiki/ISO_15924
// 匹配中英日韩俄字符和字母数字空格之外的字符 = 含有特殊字符
const REGEX_HAS_NON_WORD_CHARS =
  /[^\p{sc=Hani}\p{sc=Hira}\p{sc=Kana}\p{sc=Hang}\p{sc=Cyrl}A-Za-z0-9 ]/u;
const strHasNonWordChars = (str) => REGEX_HAS_NON_WORD_CHARS.test(str);
const REGEX_ONLY_NON_WORD_CHARS =
  /^[^\p{sc=Hani}\p{sc=Hira}\p{sc=Kana}\p{sc=Hang}\p{sc=Cyrl}A-Za-z0-9]+$/u;
const strOnlyNonWordChars = (str) => REGEX_ONLY_NON_WORD_CHARS.test(str);

module.exports.strOnlyASCII = strOnlyASCII;
module.exports.strHasASCII = strHasASCII;
module.exports.strHasHanyu = strHasHani;
module.exports.strOnlyHanyu = strOnlyHani;
module.exports.strHasHiraKana = strHasHiraKana;
module.exports.strHasHangul = strHasHangul;
module.exports.strOnlyHangul = strOnlyHangul;
module.exports.strHasNonWordChars = strHasNonWordChars;
module.exports.strOnlyNonWordChars = strOnlyNonWordChars;
