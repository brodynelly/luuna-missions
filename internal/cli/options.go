package cli

import (
	"fmt"
	"strings"
)

// Options is a small Commander-compatible option view used by Go command
// implementations. Values retains repeated flags in order.
type Options struct {
	Values      map[string][]string
	Switches    map[string]bool
	Positionals []string
}

// unknownOptionError identifies errors reported by Commander before command
// actions run. The app renders these on stderr even when --json was supplied.
type unknownOptionError struct{ option string }

func (e *unknownOptionError) Error() string {
	return fmt.Sprintf("unknown option '%s'", e.option)
}

// nestedPath finds the first depth subcommands. Options before a child command
// belong to its parent, so only inherited global switches are valid there.
func nestedPath(args []string, depth int) ([]string, error) {
	path := make([]string, 0, depth)
	afterDelimiter := false
	for _, arg := range args {
		if len(path) == depth {
			break
		}
		if !afterDelimiter && arg == "--" {
			afterDelimiter = true
			continue
		}
		if !afterDelimiter && strings.HasPrefix(arg, "-") {
			if _, err := ParseOptions([]string{arg}, nil, nil); err != nil {
				return nil, err
			}
			continue
		}
		path = append(path, arg)
	}
	return path, nil
}

func (o Options) Value(name string) string {
	values := o.Values[name]
	if len(values) == 0 {
		return ""
	}
	return values[len(values)-1]
}

func (o Options) Repeated(name string) []string {
	return append([]string(nil), o.Values[name]...)
}

func (o Options) Has(name string) bool {
	return o.Switches[name] || len(o.Values[name]) > 0
}

func ParseOptions(args, valueFlags, switchFlags []string) (Options, error) {
	result := Options{Values: map[string][]string{}, Switches: map[string]bool{}}
	values := make(map[string]bool, len(valueFlags))
	for _, name := range valueFlags {
		values[name] = true
	}
	switches := make(map[string]bool, len(switchFlags)+4)
	for _, name := range switchFlags {
		switches[name] = true
	}
	for _, name := range []string{"quiet", "verbose", "timing", "help"} {
		switches[name] = true
	}

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			result.Positionals = append(result.Positionals, args[i+1:]...)
			break
		}
		if arg == "-q" {
			result.Switches["quiet"] = true
			continue
		}
		if arg == "-h" {
			result.Switches["help"] = true
			continue
		}
		if !strings.HasPrefix(arg, "--") {
			if strings.HasPrefix(arg, "-") {
				return Options{}, &unknownOptionError{option: arg}
			}
			result.Positionals = append(result.Positionals, arg)
			continue
		}
		key := strings.TrimPrefix(arg, "--")
		inlineValue := ""
		inline := false
		if at := strings.IndexByte(key, '='); at >= 0 {
			inlineValue, key, inline = key[at+1:], key[:at], true
		}
		if values[key] {
			if inline {
				result.Values[key] = append(result.Values[key], inlineValue)
				continue
			}
			if i+1 >= len(args) || strings.HasPrefix(args[i+1], "--") {
				return Options{}, fmt.Errorf("option '--%s' argument missing", key)
			}
			i++
			result.Values[key] = append(result.Values[key], args[i])
			continue
		}
		if switches[key] && !inline {
			result.Switches[key] = true
			continue
		}
		return Options{}, &unknownOptionError{option: arg}
	}
	return result, nil
}
