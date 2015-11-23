package main

import (
	"fmt"
	"io"
	"log"
	"os/exec"
)

type hub struct {
	// Registered connections.
	connections map[*connection]bool

	// Inbound messages from the connections.
	broadcast chan []byte

	// Register requests from the connections.
	register chan *connection

	// Unregister requests from connections.
	unregister chan *connection
}

func newHub() *hub {
	return &hub{
		broadcast:   make(chan []byte),
		register:    make(chan *connection),
		unregister:  make(chan *connection),
		connections: make(map[*connection]bool),
	}
}

func listenAndSend(h *hub, stdout io.ReadCloser, fn string) {
	buf := make([]byte, 1024)
	fmt.Println(fn)
	for {

		n, _ := stdout.Read(buf)

		if n != 0 {

			msg := []byte{'[', ' '}
			msg = append(msg, fn...)
			msg = append(msg, ' ', ']')
			msg = append(msg, buf[:n]...)

			h.broadcast <- msg
		}

	}
}

func (h *hub) run() {
	files := []string{"hello.log", "tail.log"}
	outs := []io.ReadCloser{}

	for _, fn := range files {
		cmd := exec.Command("tail", "-f", fn)
		stdout, err := cmd.StdoutPipe()

		if err != nil {
			log.Fatal(err)
		}
		outs = append(outs, stdout)
		if err := cmd.Start(); err != nil {
			log.Fatal(err)
		}

	}
	fmt.Println(len(outs))
	for i, stdout := range outs {
		fmt.Println(files[i])
		go listenAndSend(h, stdout, files[i])

	}

	for {
		select {
		case c := <-h.register:
			h.connections[c] = true
		case c := <-h.unregister:
			if _, ok := h.connections[c]; ok {
				delete(h.connections, c)
				close(c.send)
			}
		case m := <-h.broadcast:
			for c := range h.connections {
				select {
				case c.send <- m:
				default:
					delete(h.connections, c)
					close(c.send)
				}
			}
		}
	}
}
