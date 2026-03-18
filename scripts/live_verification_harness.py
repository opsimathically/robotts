#!/usr/bin/env python3
import argparse
import json
import signal
import sys
import tkinter


def emit(event_name, **payload):
    message = {"event": event_name}
    message.update(payload)
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def widget_bounds(widget):
    widget.update_idletasks()
    width = widget.winfo_width()
    height = widget.winfo_height()
    root_x = widget.winfo_rootx()
    root_y = widget.winfo_rooty()
    return {
        "x": root_x,
        "y": root_y,
        "width": width,
        "height": height,
        "center": {
            "x": root_x + (width // 2),
            "y": root_y + (height // 2),
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", default="RobotTS Verification Harness")
    args = parser.parse_args()

    try:
        root = tkinter.Tk()
    except Exception as error:
        emit("startup_error", message=str(error))
        return 1

    root.title(args.title)
    root.geometry("420x320+120+120")
    root.resizable(False, False)
    root.configure(bg="#f3f6ef")

    info_label = tkinter.Label(
        root,
        text="RobotTS verification harness",
        bg="#f3f6ef",
        fg="#1f2a16",
        anchor="w",
    )
    info_label.place(x=24, y=16, width=260, height=24)

    button = tkinter.Button(root, text="Click Verify")
    button.place(x=24, y=56, width=150, height=40)

    entry_value = tkinter.StringVar()
    entry = tkinter.Entry(root, textvariable=entry_value)
    entry.place(x=24, y=126, width=260, height=34)

    swatch_label = tkinter.Label(
        root,
        text="Color swatch",
        bg="#f3f6ef",
        fg="#1f2a16",
        anchor="w",
    )
    swatch_label.place(x=24, y=184, width=120, height=20)

    swatch = tkinter.Frame(root, bg="#c0ff33", highlightthickness=1, highlightbackground="#263010")
    swatch.place(x=24, y=210, width=96, height=72)

    def on_button_click():
        emit("button_clicked")

    def on_entry_change(*_args):
        emit("input_changed", text=entry_value.get())

    def shutdown(*_args):
        try:
            emit("shutdown")
        finally:
            root.destroy()

    button.configure(command=on_button_click)
    entry_value.trace_add("write", on_entry_change)
    root.protocol("WM_DELETE_WINDOW", shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    def announce_ready():
        root.update_idletasks()
        root.lift()
        root.focus_force()
        emit(
            "ready",
            title=args.title,
            button=widget_bounds(button),
            input=widget_bounds(entry),
            color_swatch=dict(widget_bounds(swatch), hex="c0ff33"),
        )

    root.after(300, announce_ready)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
