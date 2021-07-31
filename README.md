# Audio Cli

## Introduction

Audio Cli is a command line tool for processing your audio files: parse id3 tags, split lossless audio by cue sheet file, convert mp3 or other audio to aac format, organize audio files by title or artist tag language.

## Description

Audio Cli have some useful commands:

- parse: parse ID3 tags from audio files and save to database (cache)
- split: split lossless audio files (with cue) to tracks and convert to aac format
- convert: convert audio files to aac format (using ffmpeg)
- move: move audio files to other folder by title/artist tag language
- and more... (will be added soon)

## Installation

```
npm install audio-cli -g
```

## Usage

**You must have ffmpeg executable in you PATH to use split and convert command!**

### Command Help:

```
audio-cli [parse|split|convert|move] help
```

Help message:

```
Usage: audio_cli.js <command> <input> [options]

Commands:
  audio_cli.js parse <input> [options]    Parse id3 metadata for audio files and
                                          save to database         [aliases: ps]
  audio_cli.js split <input> [options]    Split audio files by cue sheet and
                                          convert to m4a(aac)
                                                            [aliases: split, sc]
  audio_cli.js convert <input> [options]  Convert audio files to m4a(aac) format
                                          in input dir             [aliases: ct]
  audio_cli.js move <input> [options]     Move audio files by language in input
                                          dir                      [aliases: mv]

Options:
      --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### Command Parse

```
audio_cli.js parse <input> [options]

Parse id3 metadata for audio files and save to database

Positionals:
  input  Input folder that contains audio files              [string] [required]

Options:
      --version  Show version number                                   [boolean]
  -s, --save     Save parsed audio tags to database                    [boolean]
  -h, --help     Show help                                             [boolean]
```

### Command Split

```
audio_cli.js split <input> [options]

Split audio files by cue sheet and convert to m4a(aac)

Positionals:
  input  Input folder that contains audio files              [string] [required]

Options:
  -f, --libfdk, --fdk  Use libfdk_aac encoder in ffmpeg command        [boolean]
      --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### Command Convert

```
audio_cli.js convert <input> [options]

Convert audio files to m4a(aac) format in input dir

Positionals:
  input  Input folder that contains audio files              [string] [required]

Options:
  -f, --libfdk, --fdk  Use libfdk_aac encoder in ffmpeg command        [boolean]
      --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### Command Move

```
audio_cli.js move <input> [options]

Move audio files by language in input dir

Positionals:
  input  Input folder that contains audio files              [string] [required]

Options:
      --version  Show version number                                   [boolean]
  -l, --lng      Audio language that should be move (cn,ja,kr,en)
                                                           [array] [default: []]
  -u, --unknown  Move unclassified audio files to xx folder
  -h, --help     Show help                                             [boolean]
```

## License

    Copyright 2021 github@mcxiaoke.com

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
