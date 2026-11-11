'use strict';

// Change the version every time you update the app files,
// so users get the new version.
const CACHE = "myweather-v2";

const FILES = [
    "./",
    "index.html",
    "style.css",
    "script_ppl.js",
    "manifest.json",
    "img/logo.jpg",
    "img/favicon.ico",
    "img/icon-192.png",
    "img/icon-512.png"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(FILES))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const url = new URL(event.request.url);

    // Only the app's own files are cached; weather and city APIs always go to the network
    if (event.request.method !== "GET" || url.origin !== self.location.origin) {
        return;
    }

    // Network first (to always get the latest) and the cache when offline
    event.respondWith(
        fetch(event.request)
            .then(response => {
                const copy = response.clone();
                caches.open(CACHE).then(cache => cache.put(event.request, copy));
                return response;
            })
            .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
});
