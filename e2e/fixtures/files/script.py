"""Расчёт итогов по реестру договоров.

Учебный модуль: используется как фикстура предпросмотра исходного кода.
"""

from dataclasses import dataclass


VAT_RATE = 0.2


@dataclass
class Contract:
    """Одна строка реестра договоров."""

    number: int
    counterparty: str
    amount: float
    status: str


def is_active(contract: Contract) -> bool:
    """Договор считается действующим, пока он не закрыт."""
    return contract.status not in {"закрыт", "расторгнут"}


def total_amount(contracts: list[Contract]) -> float:
    """Сумма по действующим договорам без НДС."""
    return sum(contract.amount for contract in contracts if is_active(contract))


def with_vat(amount: float) -> float:
    """Сумма с НДС, округлённая до копеек."""
    return round(amount * (1 + VAT_RATE), 2)


def summary(contracts: list[Contract]) -> dict[str, float]:
    """Свод по реестру: количество, сумма и сумма с НДС."""
    active = [contract for contract in contracts if is_active(contract)]
    base = total_amount(active)
    return {
        "count": len(active),
        "amount": base,
        "amount_with_vat": with_vat(base),
    }


if __name__ == "__main__":
    rows = [
        Contract(1, "ООО «Ромашка»", 120000, "действует"),
        Contract(2, "ИП Иванов", 80000, "закрыт"),
        Contract(3, "ООО «Василёк»", 45000, "продлён"),
    ]
    print(summary(rows))
