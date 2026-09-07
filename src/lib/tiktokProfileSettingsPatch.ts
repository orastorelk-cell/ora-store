const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA TikTok profile settings] ${label} marker not found`);
  return text.replace(from, to);
};

const DEFAULT_TIKTOK_URL = 'https://www.tiktok.com/@orastore.lk?_r=1&_t=ZS-99XhW3YFUv4';

export const tiktokProfileSettingsPatch = () => ({
  name: 'ora-tiktok-profile-settings-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      let text = code;

      text = replaceRequired(
        text,
        "  const [facebookPageUrlDraft, setFacebookPageUrlDraft] = useState('');\n  const [facebookPageLinkSaved, setFacebookPageLinkSaved] = useState(false);\n",
        "  const [facebookPageUrlDraft, setFacebookPageUrlDraft] = useState('');\n  const [facebookPageLinkSaved, setFacebookPageLinkSaved] = useState(false);\n  const [tiktokProfileUrlDraft, setTiktokProfileUrlDraft] = useState('');\n  const [tiktokProfileLinkSaved, setTiktokProfileLinkSaved] = useState(false);\n",
        'Admin state',
      );

      text = replaceRequired(
        text,
        "    setFacebookPageUrlDraft(String(settings.website_facebook_page_url || 'https://www.facebook.com/orastoreofficial'));\n    setFacebookPageLinkSaved(false);\n",
        `    setFacebookPageUrlDraft(String(settings.website_facebook_page_url || 'https://www.facebook.com/orastoreofficial'));
    setFacebookPageLinkSaved(false);
    setTiktokProfileUrlDraft(String((settings as any).website_tiktok_profile_url || '${DEFAULT_TIKTOK_URL}'));
    setTiktokProfileLinkSaved(false);
`,
        'Settings draft load',
      );

      const saveTikTok = `  const saveWebsiteTikTokProfileLink = () => {
    let value = tiktokProfileUrlDraft.trim();
    if (!value) {
      alert('Please enter the TikTok profile link before saving.');
      return;
    }
    if (!/^https?:\\/\\//i.test(value)) value = 'https://' + value;
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const isTikTok = host === 'tiktok.com' || host.endsWith('.tiktok.com');
      if (!isTikTok) {
        alert('Please enter a valid TikTok profile link.');
        return;
      }
      value = url.toString();
    } catch {
      alert('Please enter a valid TikTok profile link.');
      return;
    }
    updateSettings({ website_tiktok_profile_url: value } as any);
    setTiktokProfileUrlDraft(value);
    setTiktokProfileLinkSaved(true);
    window.setTimeout(() => setTiktokProfileLinkSaved(false), 1800);
  };

`;
      text = replaceRequired(
        text,
        "  const saveBankAccountDetails = () => {",
        saveTikTok + "  const saveBankAccountDetails = () => {",
        'Save function',
      );

      const facebookStatusBlock = `              <p className={facebookPageLinkSaved ? "text-xs font-bold text-emerald-400" : "text-[10px] text-neutral-500"}>
                {facebookPageLinkSaved ? 'Saved. Website Facebook link updated.' : 'Paste the Facebook Page link and press Save.'}
              </p>
            </div>
          )}`;

      const socialStatusBlock = `              <p className={facebookPageLinkSaved ? "text-xs font-bold text-emerald-400" : "text-[10px] text-neutral-500"}>
                {facebookPageLinkSaved ? 'Saved. Website Facebook link updated.' : 'Paste the Facebook Page link and press Save.'}
              </p>

              <div className="border-t border-neutral-800 pt-4">
                <div className="mb-2">
                  <h3 className="text-sm font-black text-white">Website TikTok Profile Link</h3>
                  <p className="mt-1 text-[10px] text-neutral-500">This link is shown in the same Follow O-RA section of the website footer.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="url"
                    value={tiktokProfileUrlDraft}
                    onChange={(e) => { setTiktokProfileUrlDraft(e.target.value); setTiktokProfileLinkSaved(false); }}
                    placeholder="https://www.tiktok.com/@youraccount"
                    className="min-w-0 flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none focus:border-pink-500"
                  />
                  <button
                    type="button"
                    onClick={saveWebsiteTikTokProfileLink}
                    className="rounded-xl bg-pink-600 px-4 py-2.5 text-xs font-black text-white hover:bg-pink-500"
                  >
                    Save TikTok Link
                  </button>
                </div>
                <p className={tiktokProfileLinkSaved ? "mt-2 text-xs font-bold text-emerald-400" : "mt-2 text-[10px] text-neutral-500"}>
                  {tiktokProfileLinkSaved ? 'Saved. Website TikTok link updated.' : 'TikTok link is already filled with the O-RA account and can be changed here later.'}
                </p>
              </div>
            </div>
          )}`;
      text = replaceRequired(text, facebookStatusBlock, socialStatusBlock, 'Settings TikTok row');
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/StoreFooter.tsx')) {
      let text = code;
      text = replaceRequired(
        text,
        "import { Bot, Facebook, Headphones, Mail, MapPin, MessageCircle, PackageCheck, ShieldCheck, ShoppingBag, Truck } from 'lucide-react';",
        "import { Bot, Facebook, Headphones, Mail, MapPin, MessageCircle, Music2, PackageCheck, ShieldCheck, ShoppingBag, Truck } from 'lucide-react';",
        'Footer icon import',
      );
      text = replaceRequired(
        text,
        "  const facebookUrl=String(settings.website_facebook_page_url || 'https://www.facebook.com/orastoreofficial').trim();",
        `  const facebookUrl=String(settings.website_facebook_page_url || 'https://www.facebook.com/orastoreofficial').trim();
  const tiktokUrl=String((settings as any).website_tiktok_profile_url || '${DEFAULT_TIKTOK_URL}').trim();`,
        'Footer TikTok URL',
      );
      text = replaceRequired(
        text,
        '          <a href={facebookUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[11px] hover:text-orange-600"><Facebook className="h-4 w-4"/>Facebook</a>',
        '          <a href={facebookUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[11px] hover:text-orange-600"><Facebook className="h-4 w-4"/>Facebook</a>\n          <a href={tiktokUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[11px] hover:text-orange-600"><Music2 className="h-4 w-4"/>TikTok</a>',
        'Footer TikTok link',
      );
      return { code: text, map: null };
    }

    return null;
  },
});
