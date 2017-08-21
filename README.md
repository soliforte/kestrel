# kismap
Mapping plugin for new Kismet API

#Disclaimers

This is based on Leaflet.js and PruneCluster for clustering.
Thanks to them for their work and making this a lot easier.

# Purpose

The intent of this plugin is to add live mapping of networks into the Kismet UI directly.

# Updates

Switched map source to mapquest. Map tile sources can be switched by editing the kismap.js and switching the URL, check the Leaflet documentation for accepted sources.

In lieu of centering on current location, I center on the most recently plotted cluster, as those should be the same thing.

A couple of notes: I have not worked out how to prevent duplicate markers, so staying in one spot can lead to a LOT of markers in one spot, depending on the refresh rate (adjustable in kismap.js). Right now, it grabs devices from the last 20s, every 20s which seems pretty reasonable.

Refreshing the browser clears the map of all markers.

#TODO

Center on operator.
Draw Drivepath.
Cache offline map tiles.
Parse devices and create pins for networks.
  -Avoid plotting ALL networks
  -Only pull devices of interest?
  -Only most recently heard over n time?

#Installation

Still under heavy development, also: I don't know any javascript at all, so if you have suggestions to fix/improve, let me know.

Assuming you have the newest build of kismet installed:

   From the kismet source directory:

   clone this repository (git clone https://github.com/soliforte/kismap )

   Copy the plugin-kismap directory into the kismet directory

   cd kismet/

   make plugins-install

   start kismet server

   connect to UI (http://localhost:2501)

   Should have a new Maps tab, and your browser will ask for your location.
