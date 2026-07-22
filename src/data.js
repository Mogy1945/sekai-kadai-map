// ★ プレースホルダー: 調査ワークフロー完了後に tools/gen-data.mjs で実データに置換される
const ISSUE_DATA = {
  generated: '2026-07-22',
  placeholder: true,
  regions: [
    {
      id: 'jp', name: '日本', flag: '🇯🇵',
      issues: [
        {
          id: 'jp-aging-population', name: '少子高齢化・人口減少', emoji: '👶', category: '人口・社会',
          tagline: '(プレースホルダー)',
          overview: '開発用の仮データです。', why_problem: '仮。', future_outlook: '仮。',
          key_stats: [
            { label: '合計特殊出生率', value: '1.15', year: '2024', source_name: '厚生労働省', source_url: 'https://www.mhlw.go.jp/' },
            { label: '高齢化率', value: '29.3%', year: '2024', source_name: '内閣府', source_url: 'https://www.cao.go.jp/' },
            { label: '総人口', value: '約1億2300万人', year: '2025', source_name: '総務省統計局', source_url: 'https://www.stat.go.jp/' },
          ],
          score_inputs: { affected_population_man: 12300, affected_note: '全国民', econ_impact_trillion_yen: 30, econ_note: '仮', urgency: 5, urgency_rationale: '仮' },
          sub_issues: [
            { id: 'jp-aging-population-birthrate', name: '出生率低下', description: '仮。', severity: 5, key_stat: { label: '出生数', value: '68万人', year: '2024', source_name: '厚労省', source_url: 'https://www.mhlw.go.jp/' } },
            { id: 'jp-aging-population-care', name: '介護需要増', description: '仮。', severity: 4, key_stat: { label: '要介護認定者', value: '約700万人', year: '2024', source_name: '厚労省', source_url: 'https://www.mhlw.go.jp/' } },
            { id: 'jp-aging-population-rural', name: '地方消滅', description: '仮。', severity: 4, key_stat: { label: '消滅可能性自治体', value: '744', year: '2024', source_name: '人口戦略会議', source_url: 'https://www.example.com/' } },
          ],
          links_to_other_issues: [
            { target_id: 'jp-fiscal-sustainability', relation: '悪化させる', description: '社会保障費の増大を通じて財政を圧迫する。' },
            { target_id: 'jp-labor-shortage', relation: '原因となる', description: '生産年齢人口の減少が人手不足の主因。' },
          ],
        },
        {
          id: 'jp-fiscal-sustainability', name: '財政・社会保障の持続性', emoji: '💴', category: '経済・財政',
          tagline: '(プレースホルダー)',
          overview: '仮。', why_problem: '仮。', future_outlook: '仮。',
          key_stats: [
            { label: '国債残高', value: '約1100兆円', year: '2025', source_name: '財務省', source_url: 'https://www.mof.go.jp/' },
            { label: '社会保障給付費', value: '約140兆円', year: '2025', source_name: '厚労省', source_url: 'https://www.mhlw.go.jp/' },
            { label: '債務残高GDP比', value: '約250%', year: '2025', source_name: 'IMF', source_url: 'https://www.imf.org/' },
          ],
          score_inputs: { affected_population_man: 12300, affected_note: '全国民', econ_impact_trillion_yen: 45, econ_note: '仮', urgency: 4, urgency_rationale: '仮' },
          sub_issues: [
            { id: 'jp-fiscal-debt', name: '政府債務の累増', description: '仮。', severity: 4, key_stat: { label: '利払費', value: '約10兆円', year: '2025', source_name: '財務省', source_url: 'https://www.mof.go.jp/' } },
            { id: 'jp-fiscal-pension', name: '年金制度の持続性', description: '仮。', severity: 4, key_stat: { label: '所得代替率', value: '61.2%', year: '2024', source_name: '厚労省', source_url: 'https://www.mhlw.go.jp/' } },
            { id: 'jp-fiscal-medical', name: '医療費の増大', description: '仮。', severity: 4, key_stat: { label: '国民医療費', value: '約48兆円', year: '2023', source_name: '厚労省', source_url: 'https://www.mhlw.go.jp/' } },
          ],
          links_to_other_issues: [],
        },
        {
          id: 'jp-labor-shortage', name: '労働力不足', emoji: '🏗️', category: '労働・雇用',
          tagline: '(プレースホルダー)',
          overview: '仮。', why_problem: '仮。', future_outlook: '仮。',
          key_stats: [
            { label: '人手不足倒産', value: '過去最多', year: '2025', source_name: '帝国データバンク', source_url: 'https://www.tdb.co.jp/' },
            { label: '有効求人倍率', value: '1.2倍台', year: '2025', source_name: '厚労省', source_url: 'https://www.mhlw.go.jp/' },
            { label: '外国人労働者数', value: '約230万人', year: '2024', source_name: '厚労省', source_url: 'https://www.mhlw.go.jp/' },
          ],
          score_inputs: { affected_population_man: 6900, affected_note: '労働力人口', econ_impact_trillion_yen: 11, econ_note: '仮', urgency: 4, urgency_rationale: '仮' },
          sub_issues: [
            { id: 'jp-labor-logistics', name: '物流・建設2024年問題', description: '仮。', severity: 4, key_stat: { label: '輸送力不足', value: '14%', year: '2024', source_name: '国交省', source_url: 'https://www.mlit.go.jp/' } },
            { id: 'jp-labor-immigration', name: '外国人材受け入れ', description: '仮。', severity: 3, key_stat: { label: '育成就労制度', value: '2027年施行', year: '2024', source_name: '出入国在留管理庁', source_url: 'https://www.moj.go.jp/isa/' } },
            { id: 'jp-labor-productivity', name: '労働生産性の低迷', description: '仮。', severity: 3, key_stat: { label: 'OECD順位', value: '30位', year: '2023', source_name: '日本生産性本部', source_url: 'https://www.jpc-net.jp/' } },
          ],
          links_to_other_issues: [],
        },
      ],
      meta: { confidences: [], critic_notes: 'placeholder', method: '' },
    },
    {
      id: 'kr', name: '韓国', flag: '🇰🇷',
      issues: [
        {
          id: 'kr-ultra-low-birthrate', name: '超少子化・人口危機', emoji: '🍼', category: '人口・社会',
          tagline: '(プレースホルダー)',
          overview: '開発用の仮データです。', why_problem: '仮。', future_outlook: '仮。',
          key_stats: [
            { label: '合計特殊出生率', value: '0.75', year: '2024', source_name: '韓国統計庁', source_url: 'https://kostat.go.kr/' },
            { label: '高齢化率', value: '約20%', year: '2025', source_name: '韓国統計庁', source_url: 'https://kostat.go.kr/' },
            { label: '総人口', value: '約5170万人', year: '2025', source_name: '韓国統計庁', source_url: 'https://kostat.go.kr/' },
          ],
          score_inputs: { affected_population_man: 5170, affected_note: '全国民', econ_impact_trillion_yen: 15, econ_note: '仮', urgency: 5, urgency_rationale: '仮' },
          sub_issues: [
            { id: 'kr-birthrate-cost', name: '結婚・出産コスト', description: '仮。', severity: 5, key_stat: { label: '出生数', value: '約24万人', year: '2024', source_name: '韓国統計庁', source_url: 'https://kostat.go.kr/' } },
            { id: 'kr-birthrate-seoul', name: '首都圏一極集中', description: '仮。', severity: 4, key_stat: { label: '首都圏人口比', value: '50.8%', year: '2024', source_name: '韓国統計庁', source_url: 'https://kostat.go.kr/' } },
            { id: 'kr-birthrate-elderly', name: '高齢者貧困', description: '仮。', severity: 4, key_stat: { label: '高齢者貧困率', value: '約40%', year: '2023', source_name: 'OECD', source_url: 'https://www.oecd.org/' } },
          ],
          links_to_other_issues: [
            { target_id: 'kr-household-debt', relation: '相互に影響', description: '住居費負担が結婚・出産の抑制要因とされる。' },
          ],
        },
        {
          id: 'kr-household-debt', name: '家計債務・不動産', emoji: '🏠', category: '経済・財政',
          tagline: '(プレースホルダー)',
          overview: '仮。', why_problem: '仮。', future_outlook: '仮。',
          key_stats: [
            { label: '家計債務GDP比', value: '約100%', year: '2024', source_name: 'BIS', source_url: 'https://www.bis.org/' },
            { label: '家計債務総額', value: '約1900兆ウォン', year: '2024', source_name: '韓国銀行', source_url: 'https://www.bok.or.kr/' },
            { label: 'ソウルPIR', value: '約26倍', year: '2023', source_name: 'KB国民銀行', source_url: 'https://www.kbstar.com/' },
          ],
          score_inputs: { affected_population_man: 3000, affected_note: '債務保有世帯', econ_impact_trillion_yen: 20, econ_note: '仮', urgency: 4, urgency_rationale: '仮' },
          sub_issues: [
            { id: 'kr-debt-jeonse', name: 'チョンセ詐欺', description: '仮。', severity: 3, key_stat: { label: '被害額', value: '数兆ウォン', year: '2024', source_name: '国土交通部', source_url: 'https://www.molit.go.kr/' } },
            { id: 'kr-debt-selfemployed', name: '自営業者債務', description: '仮。', severity: 4, key_stat: { label: '自営業者比率', value: '約20%', year: '2024', source_name: '韓国統計庁', source_url: 'https://kostat.go.kr/' } },
            { id: 'kr-debt-youth', name: '若年層負債', description: '仮。', severity: 4, key_stat: { label: '2030代債務', value: '増加傾向', year: '2024', source_name: '韓国銀行', source_url: 'https://www.bok.or.kr/' } },
          ],
          links_to_other_issues: [],
        },
        {
          id: 'kr-north-korea', name: '北朝鮮リスク', emoji: '🚨', category: '安全保障・災害',
          tagline: '(プレースホルダー)',
          overview: '仮。', why_problem: '仮。', future_outlook: '仮。',
          key_stats: [
            { label: '核弾頭推計', value: '約50発', year: '2026', source_name: 'SIPRI', source_url: 'https://www.sipri.org/' },
            { label: 'ミサイル発射', value: '継続', year: '2025', source_name: '韓国国防部', source_url: 'https://www.mnd.go.kr/' },
            { label: '国防費', value: '約61兆ウォン', year: '2025', source_name: '韓国国防部', source_url: 'https://www.mnd.go.kr/' },
          ],
          score_inputs: { affected_population_man: 5170, affected_note: '全国民', econ_impact_trillion_yen: 7, econ_note: '仮', urgency: 3, urgency_rationale: '仮' },
          sub_issues: [
            { id: 'kr-nk-nuclear', name: '核・ミサイル開発', description: '仮。', severity: 5, key_stat: { label: '核弾頭', value: '約50発', year: '2026', source_name: 'SIPRI', source_url: 'https://www.sipri.org/' } },
            { id: 'kr-nk-conscription', name: '兵役と人口減の衝突', description: '仮。', severity: 3, key_stat: { label: '兵役資源', value: '減少', year: '2025', source_name: '韓国国防部', source_url: 'https://www.mnd.go.kr/' } },
            { id: 'kr-nk-cyber', name: 'サイバー攻撃', description: '仮。', severity: 3, key_stat: { label: '暗号資産窃取', value: '数十億ドル', year: '2024', source_name: '国連', source_url: 'https://www.un.org/' } },
          ],
          links_to_other_issues: [],
        },
      ],
      meta: { confidences: [], critic_notes: 'placeholder', method: '' },
    },
  ],
};

if (typeof module !== 'undefined') module.exports = { ISSUE_DATA };
