#!/bin/sh
# Re-verify a Luuna Missions release archive before trusting it.
#
#   sh scripts/release/check-archive.sh [--no-run | --require-run] ARCHIVE
#
# Checks, in order, before anything is listed or extracted:
#   - file name is luuna-missions_<version>_<darwin|linux>_<arm64|amd64>.tar.gz
#   - the mandatory SHA256SUMS next to the archive is a regular file (not a
#     symlink) with exactly one entry for the archive (an optional `*`
#     binary-mode prefix is accepted), a 64-hex-digit lowercase digest, and
#     that digest equals the archive's SHA256 (exit 4 otherwise)
#   - the listing contains exactly bin/luuna-missions and bin/lms, each once,
#     as regular files with mode 0755 (no links, devices, directories,
#     absolute paths or "..")
# Then extracts into a private temporary directory, re-checks that both are
# regular executable files and, when the archive matches the host platform
# (and --no-run is not given), runs `--help` and `--version` through both
# names and requires identical output. With --require-run, not executing
# (foreign target) is a failure (exit 6); --require-run with --no-run is a
# usage error (exit 2).
set -eu

die() {
	printf 'check-archive.sh: %s\n' "$1" >&2
	exit "${2:-1}"
}

sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{print $1}'
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | awk '{print $1}'
	else
		die "need sha256sum or shasum" 1
	fi
}

run=1
require_run=0
archive=""
while [ $# -gt 0 ]; do
	case "$1" in
	--no-run)
		run=0
		shift
		;;
	--require-run)
		require_run=1
		shift
		;;
	--help | -h)
		echo "Usage: sh scripts/release/check-archive.sh [--no-run | --require-run] ARCHIVE"
		exit 0
		;;
	-*) die "unknown option: $1" 2 ;;
	*)
		[ -z "$archive" ] || die "exactly one archive expected" 2
		archive=$1
		shift
		;;
	esac
done
[ "$run" = 1 ] || [ "$require_run" = 0 ] || die "--require-run and --no-run are mutually exclusive" 2
[ -n "$archive" ] || die "archive path required" 2
[ -f "$archive" ] && [ ! -L "$archive" ] || die "not a regular file: $archive" 2

name=$(basename "$archive")
printf '%s\n' "$name" | grep -Eq '^luuna-missions_[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?_(darwin|linux)_(arm64|amd64)\.tar\.gz$' ||
	die "unexpected archive name: $name" 3
platform=${name%.tar.gz}
arch=${platform##*_}
platform=${platform%_*}
os=${platform##*_}

dir=$(cd "$(dirname "$archive")" && pwd -P)
sums=$dir/SHA256SUMS
[ -f "$sums" ] && [ ! -L "$sums" ] || die "missing SHA256SUMS (must be a regular file, not a symlink): $sums" 4
matches=$(awk -v n="$name" '$2 == n || $2 == "*" n {c++} END {print c + 0}' "$sums") ||
	die "cannot read SHA256SUMS" 4
[ "$matches" = 1 ] || die "SHA256SUMS must have exactly one entry for $name (found $matches)" 4
expected=$(awk -v n="$name" '($2 == n || $2 == "*" n) && NF == 2 {print $1}' "$sums")
printf '%s\n' "$expected" | grep -Eq '^[0-9a-f]{64}$' || die "SHA256SUMS entry for $name is malformed" 4
actual=$(sha256_of "$dir/$name")
[ "$expected" = "$actual" ] || die "checksum mismatch for $name" 4

archive=$dir/$name
names=$(tar -tzf "$archive") || die "cannot list archive" 5
expected_names="bin/lms
bin/luuna-missions"
[ "$(printf '%s\n' "$names" | LC_ALL=C sort)" = "$expected_names" ] ||
	die "archive entries must be exactly bin/luuna-missions and bin/lms" 5
long=$(tar -tzvf "$archive") || die "cannot list archive" 5
[ "$(printf '%s\n' "$long" | wc -l | tr -d ' ')" = 2 ] || die "unexpected listing length" 5
printf '%s\n' "$long" | while IFS= read -r line; do
	case "$line" in
	-rwxr-xr-x*) ;;
	*) die "entry is not a 0755 regular file: $line" 5 ;;
	esac
done

work=$(mktemp -d "${TMPDIR:-/tmp}/luuna-missions-check.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
(cd "$work" && tar -xzf "$dir/$name")
for exe in luuna-missions lms; do
	f="$work/bin/$exe"
	[ -f "$f" ] && [ ! -L "$f" ] && [ -x "$f" ] || die "bin/$exe is not a regular executable file" 5
done
[ "$(find "$work" -mindepth 1 | wc -l | tr -d ' ')" = 3 ] || die "extraction produced unexpected files" 5

host_os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$(uname -m)" in
arm64 | aarch64) host_arch=arm64 ;;
x86_64 | amd64) host_arch=amd64 ;;
*) host_arch=unknown ;;
esac
if [ "$run" = 1 ] && [ "$os" = "$host_os" ] && [ "$arch" = "$host_arch" ]; then
	for flag in --help --version; do
		primary=$(cd "$work" && "$work/bin/luuna-missions" "$flag") || die "luuna-missions $flag failed" 6
		alias=$(cd "$work" && "$work/bin/lms" "$flag") || die "lms $flag failed" 6
		[ "$primary" = "$alias" ] || die "lms $flag output differs from luuna-missions" 6
	done
	printf 'ok %s (entries verified; --help/--version executed on host)\n' "$name"
else
	[ "$require_run" = 0 ] ||
		die "--require-run: $name was not executed (target $os/$arch, host $host_os/$host_arch)" 6
	printf 'ok %s (entries verified; not executed: target %s/%s, host %s/%s)\n' \
		"$name" "$os" "$arch" "$host_os" "$host_arch"
fi
