export const comboPackManualContentPatch = () => ({
  name: 'ora-combo-pack-manual-content-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/ComboPacksPanel.tsx')) return null;

    let text = code;

    const autoEffect = `  useEffect(() => {\n    if (!showEditor || editingCombo || manualEnglishContent) return;\n    if (form.components.filter((component) => component.product_id).length < 2) return;\n    const timer = window.setTimeout(() => { void generateComboContent(form.components); }, 700);\n    return () => window.clearTimeout(timer);\n    // Auto-fill only while the admin has not manually edited English Combo content.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [showEditor, editingCombo?.id, manualEnglishContent, form.components.map((component) => \`${component.product_id}:${component.variant_id || 'base'}:${component.quantity}\`).join('|')]);\n\n`;
    if (text.includes(autoEffect)) text = text.replace(autoEffect, '');

    const regenerateButton = `<div className="flex items-end justify-end"><button type="button" disabled={comboContentBusy || form.components.filter((component) => component.product_id).length < 2} onClick={() => void generateComboContent(form.components, true)} className={\`inline-flex items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-[10px] font-black text-violet-300 disabled:opacity-30\`}><Sparkles className="h-3.5 w-3.5" />{comboContentBusy ? 'Generating…' : 'Regenerate Description + Specs'}</button></div>`;
    if (text.includes(regenerateButton)) text = text.replace(regenerateButton, '<div />');

    text = text.replace(
      'placeholder="Auto-created from the selected single items. You can edit it manually."',
      'placeholder="Enter Combo Pack description manually."',
    );
    text = text.replace(
      'placeholder="English description එකට ගැලපෙන Sinhala auto fill වෙයි."',
      'placeholder="Enter Sinhala description manually."',
    );
    text = text.replace(
      'Selected single items 2ක් හෝ වැඩි ගණනක් දාපු ගමන්, ඒ items වල English description / item details / measurements බලලා Combo එකට ගැලපෙන English description + useful specifications auto හදනවා. Sinhala එක ඒ generated English එකෙන්ම හදනවා. Manual edit කළාම auto overwrite වෙන්නේ නැහැ; නැවත හදන්න ඕන නම් Regenerate button එක use කරන්න.',
      'Combo description, Sinhala details සහ specifications අවශ්‍ය නම් manual ලෙස ඇතුළත් කරන්න. Selected items වෙනස් කළත් මේ fields auto generate හෝ auto overwrite වෙන්නේ නැහැ.',
    );
    text = text.replace(
      'No Combo specifications yet. With 2+ selected items, they will auto-generate when source details are available.',
      'No Combo specifications yet. Add them manually if needed.',
    );

    return text === code ? null : { code: text, map: null };
  },
});
