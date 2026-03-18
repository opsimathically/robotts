#!/usr/bin/env bash
set -euo pipefail

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly minimum_node_major=22
readonly addon_output_path="${repo_root}/build/Release/robotjs.node"

PrintStep()
{
	printf '\n==> %s\n' "$1"
}

PrintInfo()
{
	printf '  %s\n' "$1"
}

PrintError()
{
	printf 'ERROR: %s\n' "$1" >&2
}

Fail()
{
	PrintError "$1"
	exit 1
}

GetDistroLabel()
{
	if [[ -f /etc/os-release ]]
	then
		# shellcheck disable=SC1091
		source /etc/os-release
		if [[ -n "${PRETTY_NAME:-}" ]]
		then
			printf '%s\n' "${PRETTY_NAME}"
			return
		fi

		if [[ -n "${NAME:-}" ]]
		then
			printf '%s\n' "${NAME}"
			return
		fi
	fi

	printf 'Linux\n'
}

RequireRepoRoot()
{
	[[ -f "${repo_root}/package.json" ]] || Fail "Run this script from the repository checkout. Missing package.json."
	[[ -f "${repo_root}/binding.gyp" ]] || Fail "Run this script from the repository checkout. Missing binding.gyp."
	[[ -f "${repo_root}/src/robotjs.cc" ]] || Fail "Run this script from the repository checkout. Missing src/robotjs.cc."
}

CheckPlatform()
{
	local kernel_name
	local distro_label

	kernel_name="$(uname -s)"
	distro_label="$(GetDistroLabel)"

	PrintInfo "Detected platform: ${kernel_name} (${distro_label})"

	if [[ "${kernel_name}" != "Linux" ]]
	then
		Fail "RobotTS is a Linux-only fork. This build helper supports Linux only."
	fi
}

CheckTooling()
{
	local required_commands=(node npm python3 make g++ pkg-config)
	local missing_commands=()
	local command_name
	local node_major_version

	for command_name in "${required_commands[@]}"
	do
		if ! command -v "${command_name}" >/dev/null 2>&1
		then
			missing_commands+=("${command_name}")
		fi
	done

	if (( ${#missing_commands[@]} > 0 ))
	then
		PrintError "Missing required build tools: ${missing_commands[*]}"
		printf '%s\n' "Install the Linux build prerequisites shown in README.md before retrying." >&2
		exit 1
	fi

	node_major_version="$(node -p "const major = Number.parseInt(process.versions.node.split('.')[0], 10); Number.isFinite(major) ? major : ''")"

	if [[ -z "${node_major_version}" ]]
	then
		Fail "Unable to determine the installed Node.js major version."
	fi

	if (( node_major_version < minimum_node_major ))
	then
		Fail "Node.js ${minimum_node_major}+ is required. Detected $(node --version)."
	fi

	PrintInfo "Node.js version: $(node --version)"
	PrintInfo "npm version: $(npm --version)"
}

CheckNativeLibraries()
{
	local pkg_names=(x11 xtst xrandr libpng zlib)
	local missing_packages=()
	local pkg_name

	for pkg_name in "${pkg_names[@]}"
	do
		if ! pkg-config --exists "${pkg_name}"
		then
			missing_packages+=("${pkg_name}")
		fi
	done

	if (( ${#missing_packages[@]} > 0 ))
	then
		PrintError "Missing native development libraries detected by pkg-config: ${missing_packages[*]}"
		printf '%s\n' "Install Linux development packages such as:" >&2
		printf '%s\n' "  sudo apt update" >&2
		printf '%s\n' "  sudo apt install -y build-essential python3 pkg-config libx11-dev libxtst-dev libxrandr-dev libpng-dev zlib1g-dev" >&2
		exit 1
	fi

	PrintInfo "Required native development libraries are available."
}

PrepareNodeGypCache()
{
	export npm_config_devdir="${npm_config_devdir:-/tmp/node-gyp-cache}"

	mkdir -p "${npm_config_devdir}"

	if [[ ! -d "${npm_config_devdir}" || ! -w "${npm_config_devdir}" ]]
	then
		Fail "npm_config_devdir must point to a writable directory. Current value: ${npm_config_devdir}"
	fi

	PrintInfo "Using npm_config_devdir=${npm_config_devdir}"
}

NodeDependenciesNeedInstall()
{
	if [[ ! -d "${repo_root}/node_modules" ]]
	then
		return 0
	fi

	if [[ ! -f "${repo_root}/node_modules/node-addon-api/package.json" ]]
	then
		return 0
	fi

	if [[ -f "${repo_root}/package-lock.json" ]]
	then
		if [[ ! -f "${repo_root}/node_modules/.package-lock.json" ]]
		then
			return 0
		fi

		if [[ "${repo_root}/package-lock.json" -nt "${repo_root}/node_modules/.package-lock.json" ]]
		then
			return 0
		fi
	fi

	return 1
}

InstallNodeDependenciesIfNeeded()
{
	if NodeDependenciesNeedInstall
	then
		PrintInfo "Installing Node dependencies with scripts disabled."
		(
			cd "${repo_root}"
			npm install --ignore-scripts
		)
	else
		PrintInfo "Node dependencies are already present and up to date."
	fi
}

BuildAddon()
{
	(
		cd "${repo_root}"
		npm run build
	)
}

VerifyBuildOutput()
{
	[[ -f "${addon_output_path}" ]] || Fail "Build completed without producing ${addon_output_path}."

	(
		cd "${repo_root}"
		node -e "require('./')"
	)

	PrintInfo "Addon output verified at ${addon_output_path}"
}

main()
{
	RequireRepoRoot

	PrintStep "Checking platform"
	CheckPlatform

	PrintStep "Checking build tools"
	CheckTooling

	PrintStep "Checking native libraries"
	CheckNativeLibraries

	PrintStep "Preparing node-gyp cache"
	PrepareNodeGypCache

	PrintStep "Preparing Node dependencies"
	InstallNodeDependenciesIfNeeded

	PrintStep "Building addon"
	if ! BuildAddon
	then
		Fail "Preflight checks passed, but node-gyp rebuild failed. See README.md troubleshooting for manual build guidance."
	fi

	PrintStep "Verifying addon"
	VerifyBuildOutput

	PrintStep "Build complete"
	PrintInfo "RobotTS is ready to use."
	PrintInfo "Addon path: ${addon_output_path}"
}

main "$@"
