ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
BACKEND := $(ROOT)/backend
FRONTEND := $(ROOT)/frontend

.PHONY: default dev install backend frontend build clean

default: dev

$(FRONTEND)/node_modules: $(FRONTEND)/package.json $(FRONTEND)/package-lock.json
	cd $(FRONTEND) && npm install

install: $(FRONTEND)/node_modules
	cd $(BACKEND) && go mod download

dev: $(FRONTEND)/node_modules
	@test -f $(FRONTEND)/.env || cp $(FRONTEND)/.env.example $(FRONTEND)/.env
	@cd $(BACKEND) && go run . & BACKEND_PID=$$!; \
	cd $(FRONTEND) && npm run dev & FRONTEND_PID=$$!; \
	trap 'kill $$BACKEND_PID $$FRONTEND_PID 2>/dev/null' INT TERM; \
	wait $$BACKEND_PID $$FRONTEND_PID

backend:
	cd $(BACKEND) && go run .

frontend: $(FRONTEND)/node_modules
	@test -f $(FRONTEND)/.env || cp $(FRONTEND)/.env.example $(FRONTEND)/.env
	cd $(FRONTEND) && npm run dev

build: $(FRONTEND)/node_modules
	cd $(BACKEND) && go build -o server .
	cd $(FRONTEND) && npm run build

clean:
	rm -f $(BACKEND)/server
	rm -rf $(FRONTEND)/.next
