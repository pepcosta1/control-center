const crypto = require('crypto');
const express = require('express');
const store = require('../services/store');

const router = express.Router();

const KEY = 'shopping_list';

function getItems() {
  return store.get(KEY, []);
}

function saveItems(items) {
  store.set(KEY, items);
}

// GET /api/shopping — llista completa
router.get('/', (req, res) => {
  res.json({ ok: true, items: getItems() });
});

// POST /api/shopping — body: { text }
router.post('/', (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ ok: false, error: 'Falta el camp "text"' });
    }
    const item = {
      id: crypto.randomUUID(),
      text: text.trim().slice(0, 200),
      done: false,
      createdAt: new Date().toISOString(),
    };
    const items = getItems();
    items.push(item);
    saveItems(items);
    res.status(201).json({ ok: true, item });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/shopping/:id — body: { done?: boolean, text?: string }
router.patch('/:id', (req, res) => {
  try {
    const items = getItems();
    const item = items.find((i) => i.id === req.params.id);
    if (!item) {
      return res.status(404).json({ ok: false, error: 'Element no trobat' });
    }
    const { done, text } = req.body || {};
    if (typeof done === 'boolean') item.done = done;
    if (typeof text === 'string' && text.trim()) item.text = text.trim().slice(0, 200);
    saveItems(items);
    res.json({ ok: true, item });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/shopping/:id — esborra un element
router.delete('/:id', (req, res) => {
  try {
    const items = getItems();
    const remaining = items.filter((i) => i.id !== req.params.id);
    if (remaining.length === items.length) {
      return res.status(404).json({ ok: false, error: 'Element no trobat' });
    }
    saveItems(remaining);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/shopping/clear-done — esborra tots els marcats com a comprats
router.post('/clear-done', (req, res) => {
  try {
    const items = getItems().filter((i) => !i.done);
    saveItems(items);
    res.json({ ok: true, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
