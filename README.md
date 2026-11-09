# Pik-König

Kartenspiel für 2–6 Spieler im Browser. Keine Anmeldung, kein Download.
Wer am Ende den Pik-König hält, verliert.

## Spielen

1. Seite öffnen → **Neuen Raum erstellen**.
2. **Freunde einladen** tippen → im Teilen-Menü **AirDrop** wählen.
   Deine Freunde landen direkt in deinem Raum. Alternativ: Link kopieren oder QR-Code zeigen.
3. Alle tragen ihren Namen ein und tippen **Hinsetzen**.
4. Der Gastgeber (wer den Raum erstellt hat) tippt **Karten verteilen**.

## Online stellen (kostenlos, einmalig ca. 10 Minuten)

Nur du brauchst dafür Konten, deine Freunde nie.

1. Konto bei **github.com** anlegen und ein neues Repository erstellen, z. B. `pik-koenig`.
2. Alle Dateien aus diesem Ordner hochladen ("Add file" → "Upload files"). `node_modules` brauchst du nicht.
3. Bei **render.com** mit dem GitHub-Konto anmelden → **New** → **Blueprint** → das Repository wählen.
   Render liest `render.yaml` und richtet alles ein.
4. Nach ein paar Minuten bekommst du eine Adresse wie `https://pik-koenig.onrender.com`.
   Die kannst du als Lesezeichen oder per „Zum Home-Bildschirm“ speichern.

Hinweis zum kostenlosen Render-Tarif: Nach 15 Minuten ohne Besucher schläft der Server ein.
Der erste Aufruf danach dauert bis zu einer Minute. Öffne die Seite also kurz vor dem Spielen.

## Lokal im WLAN spielen (ohne Hosting)

Auf einem Computer mit Node.js 18 oder neuer:

```
npm install
npm start
```

Dann im selben WLAN `http://<IP-des-Computers>:3000` öffnen.
Die IP findest du am Mac unter Systemeinstellungen → WLAN → Details.

## Aufbau

- `server.js` – Webserver und WebSocket-Räume (`/r/CODE`), Gastgeber-Wechsel, Aufräumen leerer Räume
- `game.js` – Spielregeln; der Server ist Schiedsrichter, jeder bekommt nur seine eigene Hand zu sehen
- `public/index.html` – die komplette Oberfläche
