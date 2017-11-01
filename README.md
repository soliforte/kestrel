# Kestrel ![alt text] (https://github.com/SoliForte/Kestrel/blob/master/Kestrel.png)
Mapping plugin for new Kismet API

# Disclaimers

This is based on Leaflet.js and PruneCluster for clustering.
Thanks to them for their work and making this a lot easier.
Also, a huge thanks to Dragorn (@kismetwireless) for making this whole thing possible, and his help with debugging my crap!

# Demo

[Kestrel in Action](https://www.youtube.com/watch?v=ntG1sJnQLH0)

# Purpose

The intent of this plugin is to add live mapping of networks into the Kismet UI directly.

# Updates

10-6-2017: Kestrel now supports searching! Using the main search bar above the Devices list in the Kismet UI will now also filter and display markers for only those devices. Currently, it is case SENSITIVE... working on that.

Popups have been added back in. By default popups include SSID, MAC, and TYPE of device (wifi AP, Client, Bridge, or Bluetooth).
Additionally, there is an option with kestrel.js to set autocenter on most recent location. This is disable by default as it makes it difficult to interact with the map as it resets the view every couple seconds. Just find the line towards the bottom and uncomment my stuff
Switched map source to mapquest. Map tile sources can be switched by editing the kestrel.js and switching the URL, check the Leaflet documentation for accepted sources.

In lieu of centering on current location, I center on the most recently plotted cluster, as those should be the same thing.

A couple of notes: I have not worked out how to prevent duplicate markers, so staying in one spot can lead to a LOT of markers in one spot, depending on the refresh rate (adjustable in kestrel.js). Right now, it grabs devices from the last 20s, every 20s which seems pretty reasonable.

Refreshing the browser clears the map of all markers.

# TODO
1. ~~Center on operator.~~
2. Draw Drivepath.
3. Cache offline map tiles.
4. Search function

# Installation

Still under heavy development, also: I don't know any javascript at all, so if you have suggestions to fix/improve, let me know.

Assuming you have the newest build of kismet installed (from the Kismet git-master development repository):

   Clone this repository 

    $ git clone https://github.com/soliforte/kestrel

   Install the plugin - plugins can be installed system-side or to your home directory only.

   To install system-wide (assuming your Kismet install is in the default location):

    $ cd plugin-kestrel
    $ sudo make install

   To install in the user directory, as the user who runs Kismet:

    $ cd plugin-kestrel
    $ make userinstall

   Start kismet server - if Kismet was already running, you'll need to restart it.

   Connect to the Kismet UI (http://localhost:2501)

   Kismet should now have a new Maps tab, and your browser will ask for your location.
