# 星辰代碼技能資料

擷取日期：2026-09-14。來源為本機 Global / TWN 客戶端，不使用韓服或 PC 楓之谷技能數值。

| 職業群 | 技能 | 原始技能代碼 |
| --- | --- | --- |
| 戰士 | 天上的守護者 | Skill_Warrior_HeavenlyGuardian_01 |
| 法師 | 群星的秩序 | Skill_Mage_StarOrder_01 |
| 弓箭手 | 天上的和音 | Skill_Bowman_HeavenlyHarmony_01 |
| 盜賊 | 星之獠牙 | Skill_Thief_StarFang_01 |
| 海盜 | 利維坦的詠唱 | Skill_Pirate_LavinianChant_01 |

- 資料表 manifest：Global `2.430.5730_ad1157c0`；Skill 與 TWN 語言 payload：`2.430.5729_b4d919d9`。
- Unity 圖像 manifest：`2.430.5729_0467b4fe`。圖示取自 `8836242.msm` 的 `dynamictexture/skillshopicon/varb_102_[1-5]000_0.png`，各 32 × 32 像素。
- 對應鏈：`Character/Job.ConstellaCore` → `ConstellaCorePage.Page[0].Code` → `ConstellaCore.Skill.Code`。傑諾的原表指定 `ConstellaCore_Thief`；不將副職業群 Pirate 的技能一起套用。
- `ConstellaCorePage.Level` 與 `Battle/SkillLayer.StellaCode.RequiredLevel` 皆為 250，頁面任務條件為 `StellaCode_0008`。
- 五個技能均有 `_01`～`_30`。網站顯示 Lv.30，完整 150 筆逐級 DescriptionSet 保留於 [stella-skills.json](stella-skills.json)。冷卻、傷害、打擊次數和最大攻擊次數依原表分別顯示，不再把等級追加次數重複加一次。
- 繁中敘述包含 `DescriptionSet.Elements.AddLanguageCode` 的等級追加效果與無敵限制；這不是只有技能名稱的清單。
- JSON 保留技能 ID、最高等級代碼、原始描述元素、職業映射及來源 SHA-256。沒有將未解析的特效時序或動畫硬直推估為確定數值。

重建網站卡片：`python scripts/update-stella-skills.py`。此程序只更新星辰代碼區塊及顯示計數，不修改原有技能、玩家配置、API、審核資料或模擬器。
