package cli

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestSyncPreservesFullIndexCommit(t *testing.T) {
	root := t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, output)
		}
		return string(output)
	}
	git("init", "-q")
	git("config", "user.name", "Missions Test")
	git("config", "user.email", "missions-test@example.invalid")
	app := New()
	RegisterBuiltins(app)
	app.Cwd = root
	var stdout, stderr bytes.Buffer
	app.Stdout, app.Stderr = &stdout, &stderr
	if code := app.Run([]string{"init", "--json"}); code != 0 {
		t.Fatalf("init exit %d: %s", code, stderr.String())
	}
	if err := os.WriteFile(filepath.Join(root, "already-staged.txt"), []byte("keep me\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git("add", "already-staged.txt")
	stdout.Reset()
	stderr.Reset()
	if code := app.Run([]string{"sync", "--json"}); code != 0 {
		t.Fatalf("sync exit %d: %s", code, stderr.String())
	}
	committed := git("show", "--format=", "--name-only", "HEAD")
	if !strings.Contains(committed, "already-staged.txt") || !strings.Contains(committed, ".luuna/missions/") {
		t.Fatalf("sync did not commit the existing index and Missions files:\n%s", committed)
	}
}
