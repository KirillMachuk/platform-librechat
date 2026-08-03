#!/usr/bin/env python3
"""Мини-утилита для сводки по реестру договоров.

Фикстура для тестов предпросмотра кода: файл должен читаться как обычный
рабочий скрипт — с докстрингами, комментариями и осмысленными именами.
Данные вымышленные.
"""

import csv
from collections import defaultdict
from decimal import Decimal

# Договор считается крупным, если его сумма не меньше этого порога (BYN).
LARGE_CONTRACT_THRESHOLD = Decimal("50000.00")

# Статусы, которые не учитываем в сводке: договор не порождает обязательств.
IGNORED_STATUSES = frozenset({"Расторгнут", "Черновик"})


def read_registry(path):
    """Читает CSV-реестр и возвращает список словарей.

    Пустая ячейка суммы означает «сумма не согласована» — такие строки
    оставляем, но в деньги не превращаем.
    """
    with open(path, encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def parse_amount(raw):
    """Превращает «12 480,00» в Decimal. Пустая строка -> None."""
    if not raw or not raw.strip():
        return None
    normalized = raw.replace("\u00a0", "").replace(" ", "").replace(",", ".")
    return Decimal(normalized)


def summarize(rows):
    """Считает количество и сумму договоров по каждому контрагенту."""
    totals = defaultdict(lambda: {"count": 0, "amount": Decimal("0")})
    for row in rows:
        if row.get("Статус") in IGNORED_STATUSES:
            continue
        amount = parse_amount(row.get("Сумма"))
        bucket = totals[row["Контрагент"]]
        bucket["count"] += 1
        if amount is not None:
            bucket["amount"] += amount
    return totals


def large_contracts(rows):
    """Возвращает договоры не меньше порога, от большего к меньшему."""
    result = []
    for row in rows:
        amount = parse_amount(row.get("Сумма"))
        if amount is not None and amount >= LARGE_CONTRACT_THRESHOLD:
            result.append((amount, row["Номер"], row["Контрагент"]))
    return sorted(result, reverse=True)


def main(path="data.csv"):
    """Печатает сводку по контрагентам и список крупных договоров."""
    rows = read_registry(path)
    totals = summarize(rows)

    print(f"Контрагентов в реестре: {len(totals)}")
    for name, bucket in sorted(totals.items()):
        print(f"  {name:<40} {bucket['count']:>3} шт.  {bucket['amount']:>12}")

    print("\nКрупные договоры:")
    for amount, number, name in large_contracts(rows):
        print(f"  {number:<10} {name:<40} {amount:>12}")


if __name__ == "__main__":
    main()
