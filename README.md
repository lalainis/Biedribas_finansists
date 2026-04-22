# Biedribas Finansists

Flask + Vue.js + PostgreSQL aplikacija biedribas ieņēmumu un izdevumu uzskaitei.

## Prasibas

- Python 3.11+
- PostgreSQL

## Palesana

1. Izveido `.env` no `.env.example`.
2. Uzstadi pakotnes:

   ```powershell
   pip install -r requirements.txt
   ```

3. Palaiž aplikaciju:

   ```powershell
   python app.py
   ```

4. Atver `http://127.0.0.1:5000`.

## Noklusejuma administrators

- Telefons: 29123456
- PIN: 0308

## Lomas

- cashier
- board
- auditor
- admin
- member

## Piezimes

- Ja `DATABASE_URL` nav iestatits, tiek izmantota lokala SQLite datubaze (`app.db`) demo vajadzibam.
- Produkcija ieteicams lietot PostgreSQL atbilstosi PRD.
