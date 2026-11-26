# 🎁 Wichtel-App

Kleine Web-App, mit der Mitarbeitende geheim ihren Wichtel ziehen.

## Funktionen

- **Namen ziehen:** Jede Person meldet sich an und zieht per Klick einen Namen. Der gezogene Name ist danach aus dem Topf.
- **Nie sich selbst:** Niemand kann sich selbst ziehen. Die App sorgt außerdem dafür, dass am Ende nie jemand übrig bleibt, der nur noch sich selbst ziehen könnte.
- **Persönliche Zugangscodes:** Jede Person bekommt einen eigenen Code (z. B. `K7PX-M3QD`) bzw. einen persönlichen Link, der direkt anmeldet. So kann sich niemand als jemand anderes ausgeben.
- **Erneut ansehen:** Mit demselben Code wird der gezogene Name jederzeit wieder angezeigt.
- **Spielleitung** (`/#admin`): Namen eintragen, Codes/Links kopieren (einzeln oder alle auf einmal), Status sehen (angemeldet / hat gezogen – *nicht* wer wen hat), neuen Code erzeugen, Ziehung komplett zurücksetzen.

## Starten

Benötigt nur Node.js ≥ 18, keine weiteren Pakete.

```bash
npm start            # http://localhost:3000
PORT=8080 npm start  # anderer Port
```

Die Daten liegen in `data/wichteln.json` (über `DATA_FILE` änderbar). Das Passwort der Spielleitung wird nur gehasht gespeichert.

## Ablauf

1. `http://<server>:3000/#admin` öffnen, Passwort für die Spielleitung festlegen.
2. Namen eintragen (einer pro Zeile).
3. „Alle Codes kopieren“ und jeder Person ihren Code bzw. Link schicken.
4. Jede Person meldet sich mit ihrem Code an und zieht.

Sobald die erste Person gezogen hat, ist die Teilnehmerliste gesperrt. Wer nachträglich dazukommen soll: Ziehung zurücksetzen, Namen ergänzen, alle ziehen neu.

## Tests

```bash
npm test
```

---

# 🎲 Spielekiste (gegen Langeweile)

Eine eigenständige Web-App mit acht kleinen Spielen in `langeweile/index.html`: Datei einfach im Browser öffnen, sie braucht keinen Server und keine Installation. Läuft auf Handy und Computer.

| Spiel | Worum es geht | Rekord |
|---|---|---|
| Drei gewinnt | X und O, gegen den Computer oder zu zweit | Siege gegen den Computer |
| Memory | Acht Paare finden | Wenigste Züge |
| Schlange | Äpfel fressen, wachsen, nicht anstoßen (Pfeiltasten, Wischen, Steuerkreuz) | Meiste Äpfel |
| Zahlenraten | Zahl von 1 bis 100 mit „höher/niedriger“-Tipps | Wenigste Versuche |
| Reaktionstest | Tippen, sobald es grün wird | Schnellste Zeit (ms) |
| Schere, Stein, Papier | Gegen den Computer | Längste Siegesserie |
| Farbfolge | Eine wachsende Farb- und Tonfolge nachspielen | Höchste Stufe |
| Maulwurf hauen | 30 Sekunden lang Maulwürfe treffen | Meiste Treffer |

„Überrasch mich“ startet ein zufälliges Spiel. Rekorde werden nur im Browser des Geräts gespeichert.
