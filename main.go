package main

import (
	"gopkg.in/macaron.v1"
	"log"
	"net/http"
	//"os/exec"
)

func main() {
	h := newHub()
	go h.run()

	m := macaron.Classic()
	m.Use(macaron.Renderer())
	m.Use(macaron.Static("static"))

	m.Get("/", func(ctx *macaron.Context) {
		log.Println("return the home page")
		ctx.HTML(200, "home") // return the index page
	})

	m.Any("/ws", func(resp http.ResponseWriter, req *http.Request) {
		wsh := wsHandler{h: h}
		wsh.ServeHTTP(resp, req)
	})

	m.Run()
}
