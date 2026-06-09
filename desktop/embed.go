package main

import "embed"

//go:embed frontend/*
var FrontendFS embed.FS
