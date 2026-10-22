package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func runUpgrade(ctx *Context, args []string) error {
	opts, err := ParseOptions(args, nil, []string{"check", "json"})
	if err != nil {
		return err
	}
	if len(opts.Positionals) > 0 {
		return fmt.Errorf("too many arguments for 'upgrade'")
	}
	message := "Luuna Missions is not published; update through a reviewed Luuna checkout."
	ctx.ExitCode = 1
	if opts.Has("json") {
		return ctx.JSON(struct {
			Success bool   `json:"success"`
			Command string `json:"command"`
			Error   string `json:"error"`
			Updated bool   `json:"updated"`
		}{false, "upgrade", message, false})
	}
	_, err = fmt.Fprintln(ctx.Stderr, message)
	return err
}

var guardedFileAdvice = map[string]string{
	"issues.jsonl":    "luuna-missions create / luuna-missions update / luuna-missions close / luuna-missions dep / luuna-missions label",
	"plans.jsonl":     "luuna-missions plan (submit / edit / adopt / reorder)",
	"templates.jsonl": "luuna-missions tpl",
}

func guardReason(input map[string]any, cwd string) string {
	tool, _ := input["tool_name"].(string)
	key := map[string]string{"Write": "file_path", "Edit": "file_path", "MultiEdit": "file_path", "NotebookEdit": "notebook_path"}[tool]
	if key == "" {
		return ""
	}
	toolInput, _ := input["tool_input"].(map[string]any)
	target, _ := toolInput[key].(string)
	if target == "" {
		return ""
	}
	if inputCwd, ok := input["cwd"].(string); ok && inputCwd != "" {
		cwd = inputCwd
	}
	abs := target
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(cwd, target)
	}
	abs = filepath.Clean(abs)
	file := filepath.Base(abs)
	dir := filepath.Dir(abs)
	if filepath.Base(dir) != "missions" || filepath.Base(filepath.Dir(dir)) != ".luuna" || !strings.HasSuffix(file, ".jsonl") {
		return ""
	}
	use := guardedFileAdvice[file]
	if use == "" {
		use = "the luuna-missions CLI"
	}
	return fmt.Sprintf("missions: do not edit .luuna/missions/%s by hand; use %s (luuna-missions commands lock, validate, and dedup the store).", file, use)
}

func runGuard(ctx *Context, args []string) error {
	if len(args) > 0 {
		return fmt.Errorf("too many arguments for 'guard'")
	}
	if input, ok := ctx.Stdin.(*os.File); ok {
		if info, err := input.Stat(); err == nil && info.Mode()&os.ModeCharDevice != 0 {
			return nil
		}
	}
	raw, err := io.ReadAll(ctx.Stdin)
	if err != nil {
		return err
	}
	var input map[string]any
	if json.Unmarshal(raw, &input) != nil {
		return nil
	}
	reason := guardReason(input, ctx.Cwd)
	if reason == "" {
		return nil
	}
	encoder := json.NewEncoder(ctx.Stdout)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(struct {
		HookSpecificOutput struct {
			HookEventName            string `json:"hookEventName"`
			PermissionDecision       string `json:"permissionDecision"`
			PermissionDecisionReason string `json:"permissionDecisionReason"`
		} `json:"hookSpecificOutput"`
	}{HookSpecificOutput: struct {
		HookEventName            string `json:"hookEventName"`
		PermissionDecision       string `json:"permissionDecision"`
		PermissionDecisionReason string `json:"permissionDecisionReason"`
	}{"PreToolUse", "deny", reason}})
}
