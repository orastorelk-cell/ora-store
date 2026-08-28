const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA Facebook page settings] ${label} marker not found`);
  return text.replace(from, to);
};

export const facebookPageSettingsPatch = () => ({
  name: 'ora-facebook-page-settings-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\\\/g, '/');

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      let text = code;

      text = replaceRequired(
        text,
        "  const [bankDetailsSavedFlash, setBankDetailsSavedFlash] = useState(false);\n",
        "  const [bankDetailsSavedFlash, setBankDetailsSavedFlash] = useState(false);\n  const [facebookPageUrlDraft, setFacebookPageUrlDraft] = useState('');\n  const [facebookPageLinkSaved, setFacebookPageLinkSaved] = useState(false);\n",
        'Admin state',
      );

      const settingsEffect = `    setBankDraft({
      bank_name: settings.bank_name || '',
      bank_account_holder: settings.bank_account_holder || '',
      bank_account_number: settings.bank_account_number || '',
      bank_branch: settings.bank_branch || '',
    });
  }, [activeTab]);`;
      const settingsEffectWithFacebook = `    setBankDraft({
      bank_name: settings.bank_name || '',
      bank_account_holder: settings.bank_account_holder || '',
      bank_account_number: settings.bank_account_number || '',
      bank_branch: settings.bank_branch || '',
    });
    setFacebookPageUrlDraft(String(settings.website_facebook_page_url || 'https://www.facebook.com/orastoreofficial'));
    setFacebookPageLinkSaved(false);
  }, [activeTab]);`;
      text = replaceRequired(text, settingsEffect, settingsEffectWithFacebook, 'Settings draft load');

      const saveFacebook = `  const saveWebsiteFacebookPageLink = () => {
    let value = facebookPageUrlDraft.trim();
    if (!value) {
      alert('Please enter the Facebook Page link before saving.');
      return;
    }
    if (!/^https?:\\/\\//i.test(value)) value = 'https://' + value;
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const isFacebook = host === 'facebook.com'
        || host.endsWith('.facebook.com')
        || host === 'fb.com'
        || host.endsWith('.fb.com');
      if (!isFacebook) {
        alert('Please enter a valid Facebook Page link.');
        return;
      }
      value = url.toString();
    } catch {
      alert('Please enter a valid Facebook Page link.');
      return;
    }
    updateSettings({ website_facebook_page_url: value });
    setFacebookPageUrlDraft(value);
    setFacebookPageLinkSaved(true);
    window.setTimeout(() => setFacebookPageLinkSaved(false), 1800);
  };

`;
      text = replaceRequired(
        text,
        "  const saveBankAccountDetails = () => {",
        saveFacebook + "  const saveBankAccountDetails = () => {",
        'Save function',
      );

      const settingsStart = `      {activeTab === 'settings' && (
        <div className="space-y-6 max-w-4xl">
          <div className="rounded-2xl border border-orange-500/30 bg-neutral-900 p-5 space-y-4">`;
      const settingsStartWithFacebook = `      {activeTab === 'settings' && (
        <div className="space-y-6 max-w-4xl">
          {adminUser?.role === 'admin' && (
            <div className="rounded-2xl border border-blue-500/30 bg-neutral-900 p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-xl bg-blue-500/10 p-2 text-blue-300"><Share2 className="h-4 w-4" /></div>
                <div>
                  <h2 className="text-base font-black text-white">Website Facebook Page Link</h2>
                  <p className="mt-1 text-xs text-neutral-400">Super Admin can change the Facebook link used by the website footer. Existing website features are not changed.</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="url"
                  value={facebookPageUrlDraft}
                  onChange={(e) => { setFacebookPageUrlDraft(e.target.value); setFacebookPageLinkSaved(false); }}
                  placeholder="https://www.facebook.com/yourpage"
                  className="min-w-0 flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={saveWebsiteFacebookPageLink}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white hover:bg-blue-500"
                >
                  Save Facebook Link
                </button>
              </div>
              <p className={facebookPageLinkSaved ? "text-xs font-bold text-emerald-400" : "text-[10px] text-neutral-500"}>
                {facebookPageLinkSaved ? 'Saved. Website Facebook link updated.' : 'Paste the Facebook Page link and press Save.'}
              </p>
            </div>
          )}

          <div className="rounded-2xl border border-orange-500/30 bg-neutral-900 p-5 space-y-4">`;
      text = replaceRequired(text, settingsStart, settingsStartWithFacebook, 'Settings card');
      return { code: text, map: null };
    }

    return null;
  },
});
