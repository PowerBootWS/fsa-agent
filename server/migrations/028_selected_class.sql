-- Class switcher (2026-10-21). A student can hold more than one class at once
-- (4th Class papers alongside 3rd/2nd, or 4A + 4B). This records which one the
-- platform shows them; NULL means "highest class held". Nothing else reads it.
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS selected_class_code text;
