# Vault ↔ Device Sync Setup (Obsidian + OneDrive) — Handover Doc

How to make the IntelBot knowledge vault available on a person's device (e.g.
Mike's laptop) for editing in Obsidian, kept in two-way sync with the master
copy in SharePoint. Repeat these steps on **each** device that should edit the
vault. The IntelBot server reads the same SharePoint folder independently (via
Microsoft Graph), so it does **not** depend on any device's OneDrive.

## The model (one master, many copies)

```
SharePoint  "CEO Intelbot"  ← MASTER (single source of truth, in Microsoft 365)
   ▲  OneDrive (2-way)              │  Microsoft Graph (server pull, ~10 min)
   ▼                                ▼
Device(s): Obsidian              IntelBot server (Railway) — the bot's read copy
```

- Site: `nreagency.sharepoint.com/sites/uRentTeam`
- Library: **Documents** → folder **CEO Intelbot**

## Prerequisites (the "gate" — all must be true)

1. A Microsoft 365 account in the **NOONAN Real Estate Agency** tenant.
2. That account is a **member of the UPE Team (uRent Property Ecosystem)** site.
3. The **OneDrive sync client** is installed and **signed in** with that account
   (standard on Windows with Microsoft 365).
4. **Obsidian** is installed on the device.

If any of these is false, sync won't appear — fix that first, it is not a bug.

## Steps (per device)

1. In SharePoint, open **Documents → CEO Intelbot**.
2. In the top toolbar, click **Add shortcut to OneDrive** (or **Sync**). Wait for
   OneDrive to finish — a green check appears on the folder.
3. Open **File Explorer**. Under **OneDrive - NOONAN Real Estate Agency** you'll
   see a **CEO Intelbot** shortcut/folder.
4. **Right-click the CEO Intelbot folder → "Always keep on this device."**
   (Critical — otherwise OneDrive keeps files cloud-only and Obsidian can't read
   them reliably.)
5. Open **Obsidian → "Open folder as vault"** → select that synced **CEO Intelbot**
   folder.
6. Verify: edit a note in Obsidian, then refresh the SharePoint web view — your
   change should appear within a minute or two. Edit one in SharePoint — it should
   appear in Obsidian. That confirms two-way sync.

## Multi-device

Repeat the steps on every device. They all sync through SharePoint, so an edit on
one device propagates to the others (and to the bot) automatically.

## Known gotchas

- **Cloud-only placeholders:** if notes look present but Obsidian can't open them,
  the folder isn't set to "Always keep on this device" (step 4).
- **`.obsidian` config:** Obsidian writes a hidden `.obsidian` settings folder. If
  the same vault is opened on multiple devices, plugin/settings files can produce
  OneDrive "conflict" copies. The notes themselves are unaffected. For a single
  primary user this is a non-issue; if it gets noisy, keep Obsidian settings on one
  "primary" device.
- **Simultaneous edits:** editing the same note on two devices at once can create a
  OneDrive conflict copy (`note 1.md`). Fine for a single user; just delete the
  stray copy.
- **First sync time:** a large vault takes a few minutes to download the first time.

## Relationship to the bot

The IntelBot server keeps its **own** copy of this folder on its Railway disk,
refreshed from SharePoint on a schedule (and on demand via the "Sync now" button in
Settings). So the bot always reflects the master in SharePoint — it never reads a
device directly. A device being offline does not affect the bot.
