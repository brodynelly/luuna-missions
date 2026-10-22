package cli

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestNestedHelpUsesCommandSnapshot(t *testing.T) {
	app := New()
	RegisterBuiltins(app)
	app.Cwd = t.TempDir()
	var out, errOut bytes.Buffer
	app.Stdout, app.Stderr = &out, &errOut
	if code := app.Run([]string{"tpl", "step", "add", "missing", "--help"}); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	want, found := helpSnapshot([]string{"tpl", "step", "add", "missing", "--help"})
	if !found || out.String() != want {
		t.Fatalf("nested help differed from snapshot\nwant: %q\ngot: %q", want, out.String())
	}
}

func TestTopLevelHelpPrecedesUnrecognizedOptions(t *testing.T) {
	for _, args := range [][]string{
		{"--json", "--help"},
		{"--format", "json", "--help"},
		{"--json", "config", "--help"},
		{"--quiet", "--json", "--help"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			app := New()
			RegisterBuiltins(app)
			var out, errOut bytes.Buffer
			app.Stdout, app.Stderr = &out, &errOut
			if code := app.Run(args); code != 0 || out.String() != app.Help() || errOut.Len() != 0 {
				t.Fatalf("exit=%d stdout=%q stderr=%q", code, out.String(), errOut.String())
			}
		})
	}
}

func TestTopLevelNoCommandAndVersionOrdering(t *testing.T) {
	for _, args := range [][]string{nil, {"--quiet"}} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			app := New()
			RegisterBuiltins(app)
			var out, errOut bytes.Buffer
			app.Stdout, app.Stderr = &out, &errOut
			if code := app.Run(args); code != 1 || out.Len() != 0 || errOut.String() != app.Help() {
				t.Fatalf("exit=%d stdout=%q stderr=%q", code, out.String(), errOut.String())
			}
		})
	}
	for _, args := range [][]string{
		{"--version", "--help"},
		{"--help", "--version"},
		{"list", "--version"},
		{"--format", "json", "--version"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			app := New()
			RegisterBuiltins(app)
			var out, errOut bytes.Buffer
			app.Stdout, app.Stderr = &out, &errOut
			if code := app.Run(args); code != 0 || out.String() != app.Version+"\n" || errOut.Len() != 0 {
				t.Fatalf("exit=%d stdout=%q stderr=%q", code, out.String(), errOut.String())
			}
		})
	}
	for _, tt := range []struct {
		args []string
		flag string
	}{
		{[]string{"--json"}, "--json"},
		{[]string{"--json", "list"}, "--json"},
		{[]string{"--format", "json"}, "--format"},
	} {
		t.Run(strings.Join(tt.args, " "), func(t *testing.T) {
			app := New()
			RegisterBuiltins(app)
			var out, errOut bytes.Buffer
			app.Stdout, app.Stderr = &out, &errOut
			if code := app.Run(tt.args); code != 1 || out.Len() != 0 || errOut.String() != "error: unknown option '"+tt.flag+"'\n" {
				t.Fatalf("exit=%d stdout=%q stderr=%q", code, out.String(), errOut.String())
			}
		})
	}
}

func TestLoggingLevelEnvironment(t *testing.T) {
	t.Setenv("LUUNA_MISSIONS_DEBUG", "1")
	t.Setenv("LUUNA_MISSIONS_LOG_LEVEL", "")
	app := New()
	RegisterBuiltins(app)
	app.Cwd = t.TempDir()
	var out, errOut bytes.Buffer
	app.Stdout, app.Stderr = &out, &errOut
	if code := app.Run([]string{"show", "missing", "--json"}); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	firstLine := strings.SplitN(out.String(), "\n", 2)[0]
	var event map[string]any
	if err := json.Unmarshal([]byte(firstLine), &event); err != nil {
		t.Fatalf("debug record: %s", err)
	}
	if event["level"] != float64(20) || event["cmd"] != "show" {
		t.Fatalf("unexpected debug record: %v", event)
	}
	t.Setenv("LUUNA_MISSIONS_LOG_LEVEL", "silent")
	out.Reset()
	if code := app.Run([]string{"show", "missing", "--json"}); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	if strings.Contains(out.String(), "\"level\":20") {
		t.Fatal("explicit silent level did not override LUUNA_MISSIONS_DEBUG")
	}
}
