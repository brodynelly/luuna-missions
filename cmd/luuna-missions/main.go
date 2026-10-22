package main

import (
	"os"

	"github.com/brodynelly/luuna-missions/internal/cli"
	"github.com/brodynelly/luuna-missions/internal/plan"
)

func main() {
	ignoreBrokenPipeSignal()
	app := cli.New()
	cli.RegisterBuiltins(app)
	plan.Register(app)
	os.Exit(app.Run(os.Args[1:]))
}
