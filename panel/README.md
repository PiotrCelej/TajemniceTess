# Panel prowadzącego Rudna Brama

Migawka kodu wersji 3 panelu i aplikacji śledzenia postępów. Odpowiada rewizji źródeł `9f5abffaf1d7c87d7e6852d7d82e8b1128fb4d51`. Zawiera nawigację między scenami, wyszukiwanie, testy, zagadki, notatki MG, widok gracza, licznik PW, śledzenie postępów i osobną stronę podsumowania. [Wdrożony panel](https://rudna-brama-kronika.piotrek-celej.chatgpt.site)

## Uruchomienie w VS Code

Uruchom w terminalu z katalogu głównego repozytorium. Podgląd wymaga Node.js z obsługą `node:sqlite`, np. Node 24, i korzysta wyłącznie z modułów wbudowanych.

```bash
cd panel
npm run dev
```

Otwórz `http://127.0.0.1:3000`. W podglądzie zapis działa dla lokalnego użytkownika testowego w bazie SQLite w pamięci. Zamknięcie procesu kończy ten zapis serwerowy. Panel utrzymuje też zapis w przeglądarce. Polecenie `npm run build` tworzy Worker w `dist/server/index.js`.

| Ścieżka | Zawartość |
| --- | --- |
| `public/data.js` | Sceny, NPC, zagadki, lokacje i podsumowanie kampanii z wersji 3 |
| `public/app.js` i `public/sync.js` | Interfejs i synchronizacja postępów |
| `server/worker.mjs` | Obsługa strony i zapisu przez API |
| `drizzle/0000_campaign_progress.sql` | Schemat postępów |

Migawka zawiera kod i schemat bazy. Zapisy konkretnych użytkowników są przechowywane w aplikacji. Konfiguracja zachowuje wiązanie bazy `DB`, a identyfikator produkcyjnej witryny został odłączony na potrzeby pracy lokalnej.

Opisy sesji 2 w wersji 3 panelu pochodzą z 12 listopada. Przy synchronizacji treści zacznij od późniejszej [Księgi MG z 24 listopada](../materialy/sesja-02/a4/01_Ksiega_MG.pdf), [stanu po sesji 1](../docs/stan-kampanii.md) i [aktualnego scenariusza sesji 2](../docs/sesja-02.md).
