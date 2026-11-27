# Reviewed capture provenance

Baseline `f01e5f353b97d5bdea79774ead8f9c218a190f43`.

The web files in this commit are the reviewed Home, Energy, and Command corrections. Phone legends say vehicle charging, an illustrative scene does not claim a Tesla connection, and Command phone power rows keep their full values. Desktop Command columns are unchanged.

`library-header-390.patch` is the reviewed Library phone header correction for the separate capture renderer. It is not a live Atlas route and it does not add a backend. Apply it only to that renderer's `src/web/library/library.css`. Below 700 px the status chip sits on its own row. The desktop header stays one row.

Reviewed freeze `aa0725ac683408ca6ec5df5816493245b58229f9df33e10eca40060b465ed059`.

Review package `e4680043f9b31b280ec547f4596b2005010981948b4b125a42c49015b3296c39`.

This folder does not include privacy diffs, household equipment notes, document files, or capture snapshots.
