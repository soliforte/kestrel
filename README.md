# kismap
Mapping plugin for new Kismet API

# Purpose

The intent of this plugin is to add live mapping of networks into the Kismet UI directly.
Currently, this only loads a leaflet map into a tab in the Kismet UI.

#TODO

Write client to connect to Kismet API via JS.
Center on operator.
Draw Drivepath.
Cache offline map tiles.
Parse devices and create pins for networks.
  -Avoid plotting ALL networks
  -Only pull devices of interest?
  -Only most recently heard over n time?
  
#Installation

Still under heavy development, also: I don't know any javascript at all, so if you have suggestions to fix/improve, let me know.

Assuming you have the newest build of kismet install:
   from the kismet source directory:
   mkdir plugin-kismap
   cd plugin-kismap
   clone this repo
   cd ../
   make plugins-install
   start kismet server
   connect to UI (http://localhost:2501)
   
   If it worked, you should get a popup that says it loaded.
