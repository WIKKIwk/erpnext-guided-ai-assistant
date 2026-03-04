from __future__ import annotations


def _msg(lang: str, *, uz: str, ru: str, en: str) -> str:
	if lang == "ru":
		return ru
	if lang == "en":
		return en
	return uz


def _action_clarify_reply(lang: str) -> str:
	return _msg(
		lang,
		uz=(
			"Albatta. Qaysi harakatni ko'rsatib beray?\n"
			"Masalan: yangi Item qo'shish, yangi Sales Invoice yaratish, yoki boshqa Doctype ochish."
		),
		ru=(
			"Конечно. Какое действие показать?\n"
			"Например: создать новый Item, создать Sales Invoice или открыть другой DocType."
		),
		en=(
			"Sure. Which action should I demonstrate?\n"
			"For example: create a new Item, create a Sales Invoice, or open another DocType."
		),
	)


def _target_clarify_reply(lang: str) -> str:
	return _msg(
		lang,
		uz="Tayyorman. Qaysi DocType uchun yangi yozuv yaratamiz? (masalan: Item, Customer, Sales Invoice)",
		ru="Готово. Для какого DocType создаём новую запись? (например: Item, Customer, Sales Invoice)",
		en="Ready. For which DocType should we create a new record? (e.g., Item, Customer, Sales Invoice)",
	)


def _start_tutorial_reply(lang: str, doctype: str) -> str:
	return _msg(
		lang,
		uz=(
			f"Zo'r, endi **{doctype}** bo'yicha amaliy ko'rsataman: ro'yxatni ochamiz, `Add/New` ni bosamiz "
			"va asosiy maydonlarni demo tarzda to'ldiramiz. Xavfsizlik uchun `Save/Submit` ni avtomatik bosmayman."
		),
		ru=(
			f"Отлично, сейчас покажу практический сценарий для **{doctype}**: откроем список, нажмём `Add/New` "
			"и заполним базовые поля в демо-режиме. Из соображений безопасности `Save/Submit` автоматически не нажимаю."
		),
		en=(
			f"Great, I will walk you through **{doctype}**: open the list, click `Add/New`, and fill key fields in demo mode. "
			"For safety, I will not click `Save/Submit` automatically."
		),
	)


def _continue_tutorial_reply(lang: str, doctype: str, stage: str) -> str:
	if stage == "show_save_only":
		return _msg(
			lang,
			uz=f"Tushunarli. **{doctype}** formasida `Save/Submit` joyini ko'rsataman, lekin uni bosmayman.",
			ru=f"Понял. На форме **{doctype}** покажу, где находится `Save/Submit`, но нажимать не буду.",
			en=f"Understood. On the **{doctype}** form, I will show where `Save/Submit` is, but I will not click it.",
		)
	return _msg(
		lang,
		uz=f"Mayli, **{doctype}** bo'yicha keyingi bosqichni davom ettiraman va qo'shimcha maydonlarni to'ldirib ko'rsataman.",
		ru=f"Хорошо, продолжаю следующий шаг по **{doctype}** и покажу заполнение дополнительных полей.",
		en=f"Alright, I will continue the next **{doctype}** step and demonstrate filling additional fields.",
	)


def _manage_roles_reply(lang: str, doctype: str = "User") -> str:
	if str(doctype or "").strip().lower() == "user":
		return _msg(
			lang,
			uz=(
				"Tushundim. Endi mavjud **User** uchun role qo'shishni amaliy ko'rsataman: "
				"User kartasini ochamiz, `Roles & Permissions` bo'limiga o'tamiz va role qatorini qo'shamiz."
			),
			ru=(
				"Понял. Сейчас покажу, как добавить роль существующему **User**: "
				"откроем карточку пользователя, перейдём в `Roles & Permissions` и добавим строку роли."
			),
			en=(
				"Understood. I will demonstrate adding a role to an existing **User**: "
				"open the user card, go to `Roles & Permissions`, and add a role row."
			),
		)
	return _msg(
		lang,
		uz=(
			f"Tushundim. Endi **{doctype}** bo'limi orqali role/permission sozlash yo'lini amalda ko'rsataman."
		),
		ru=(
			f"Понял. Сейчас покажу практический путь настройки ролей/прав через раздел **{doctype}**."
		),
		en=(
			f"Understood. I will show the practical role/permission setup path through **{doctype}**."
		),
	)
