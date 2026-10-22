//go:build unix

package main

import (
	"os/signal"
	"syscall"
)

// Convert a closed stdout pipe into EPIPE so the CLI can return successfully.
func ignoreBrokenPipeSignal() {
	signal.Ignore(syscall.SIGPIPE)
}
