/* ===================================================================
   AI 图片生成器 — app.js
   双模式：单图生成 + 漫画分镜批量生成
   兼容 url 和 b64_json 两种响应格式
   多 API 站点适配（GrsAI / OpenAI / SiliconFlow / Gemini）
   =================================================================== */

// ─── 工具函数 ──────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const icon = name => `<span class="ui-icon ui-icon-${name}" aria-hidden="true"></span>`;
const setIconText = (el, name, text) => { if (el) el.innerHTML = `${icon(name)} ${tr(text)}`; };

function openFileInputOnce(input) {
  if (!input) return;
  const now = Date.now();
  if (input._lastPickerOpenAt && now - input._lastPickerOpenAt < 900) return;
  input._lastPickerOpenAt = now;
  input.click();
  setTimeout(() => {
    if (input._lastPickerOpenAt === now) input._lastPickerOpenAt = 0;
  }, 1200);
}

// ─── 国际化 ────────────────────────────────────────────────
const LANG_KEY = "ai_image_gen_language";
const SUPPORTED_LANGS = ["zh-CN", "zh-Hant", "en", "ja", "ko"];
let currentLanguage = SUPPORTED_LANGS.includes(localStorage.getItem(LANG_KEY))
  ? localStorage.getItem(LANG_KEY)
  : "zh-CN";
let isApplyingLanguage = false;

const I18N = {
  "界面语言": { "zh-Hant": "介面語言", en: "Interface language", ja: "表示言語", ko: "화면 언어" },
  "查看生图记录": { "zh-Hant": "查看生圖記錄", en: "View generation history", ja: "生成履歴を表示", ko: "생성 기록 보기" },
  "设置": { "zh-Hant": "設定", en: "Settings", ja: "設定", ko: "설정" },
  "切换主题": { "zh-Hant": "切換主題", en: "Toggle theme", ja: "テーマ切替", ko: "테마 전환" },
  "关闭": { "zh-Hant": "關閉", en: "Close", ja: "閉じる", ko: "닫기" },
  "AI 图片生成器": { "zh-Hant": "AI 圖片生成器", en: "AI Image Generator", ja: "AI 画像生成", ko: "AI 이미지 생성기" },
  "单图生成 · 漫画分镜批量生成": { "zh-Hant": "單圖生成 · 漫畫分鏡批次生成", en: "Single image generation · Batch comic storyboard generation", ja: "単体画像生成 · 漫画ストーリーボード一括生成", ko: "단일 이미지 생성 · 만화 컷 일괄 생성" },
  "API 配置": { "zh-Hant": "API 設定", en: "API Settings", ja: "API 設定", ko: "API 설정" },
  "已保存的 API": { "zh-Hant": "已儲存的 API", en: "Saved APIs", ja: "保存済み API", ko: "저장된 API" },
  "— 手动填写 —": { "zh-Hant": "— 手動填寫 —", en: "— Manual entry —", ja: "— 手動入力 —", ko: "— 직접 입력 —" },
  "删除当前配置": { "zh-Hant": "刪除目前設定", en: "Delete current config", ja: "現在の設定を削除", ko: "현재 설정 삭제" },
  "API 地址": { "zh-Hant": "API 位址", en: "API URL", ja: "API URL", ko: "API 주소" },
  "https://grsai.dakka.com.cn": { "zh-Hant": "https://grsai.dakka.com.cn", en: "https://grsai.dakka.com.cn", ja: "https://grsai.dakka.com.cn", ko: "https://grsai.dakka.com.cn" },
  "推荐使用 GrsAI 第三方 API": { "zh-Hant": "推薦使用 GrsAI 第三方 API", en: "Recommended: GrsAI third-party API", ja: "おすすめ：GrsAI サードパーティ API", ko: "추천: GrsAI 서드파티 API" },
  "填入推荐地址": { "zh-Hant": "填入推薦位址", en: "Use recommended URL", ja: "推奨 URL を入力", ko: "추천 주소 입력" },
  "显示/隐藏": { "zh-Hant": "顯示/隱藏", en: "Show/Hide", ja: "表示/非表示", ko: "표시/숨김" },
  "模型": { "zh-Hant": "模型", en: "Model", ja: "モデル", ko: "모델" },
  "从 API 检测可用模型": { "zh-Hant": "從 API 偵測可用模型", en: "Detect available models from API", ja: "API から利用可能なモデルを検出", ko: "API에서 사용 가능한 모델 감지" },
  "检测": { "zh-Hant": "偵測", en: "Detect", ja: "検出", ko: "감지" },
  "检测中": { "zh-Hant": "偵測中", en: "Detecting", ja: "検出中", ko: "감지 중" },
  "电脑端代理地址": { "zh-Hant": "電腦端代理位址", en: "Desktop proxy URL", ja: "PC 用プロキシ URL", ko: "PC 프록시 주소" },
  "(可选，用于解决浏览器 CORS)": { "zh-Hant": "（可選，用於解決瀏覽器 CORS）", en: "(optional, for browser CORS)", ja: "（任意、ブラウザー CORS 対策）", ko: "(선택, 브라우저 CORS 해결용)" },
  "保存配置": { "zh-Hant": "儲存設定", en: "Save config", ja: "設定を保存", ko: "설정 저장" },
  "单图模式": { "zh-Hant": "單圖模式", en: "Single Image", ja: "単体画像", ko: "단일 이미지" },
  "漫画分镜": { "zh-Hant": "漫畫分鏡", en: "Comic Panels", ja: "漫画コマ", ko: "만화 컷" },
  "全局提示词": { "zh-Hant": "全域提示詞", en: "Global Prompt", ja: "全体プロンプト", ko: "전역 프롬프트" },
  "全局提示词（注入所有分镜）": { "zh-Hant": "全域提示詞（注入所有分鏡）", en: "Global Prompt (applied to all panels)", ja: "全体プロンプト（全コマに適用）", ko: "전역 프롬프트(모든 컷에 적용)" },
  "提示词": { "zh-Hant": "提示詞", en: "Prompt", ja: "プロンプト", ko: "프롬프트" },
  "导入 txt": { "zh-Hant": "匯入 txt", en: "Import txt", ja: "txt を読み込み", ko: "txt 가져오기" },
  "导入 txt 文件作为参考（支持多选）": { "zh-Hant": "匯入 txt 檔作為參考（支援多選）", en: "Import txt files as references (multiple allowed)", ja: "参照用 txt ファイルを読み込み（複数可）", ko: "참고용 txt 파일 가져오기(복수 선택 가능)" },
  "描述你想生成的图片，越详细越好……\n\n例如：一只橘猫坐在窗台上，阳光透过纱帘洒在它身上，油画风格，暖色调": { "zh-Hant": "描述你想生成的圖片，越詳細越好……\n\n例如：一隻橘貓坐在窗台上，陽光透過紗簾灑在牠身上，油畫風格，暖色調", en: "Describe the image you want to generate. More detail is better...\n\nExample: an orange cat sitting on a windowsill, sunlight passing through sheer curtains, oil painting style, warm tones", ja: "生成したい画像をできるだけ詳しく説明してください……\n\n例：窓辺に座る茶トラ猫、薄いカーテン越しの陽光、油彩風、暖色調", ko: "생성하고 싶은 이미지를 자세히 설명하세요...\n\n예: 창가에 앉은 주황색 고양이, 얇은 커튼 사이로 들어오는 햇빛, 유화 스타일, 따뜻한 색감" },
  "全局参考图片": { "zh-Hant": "全域參考圖片", en: "Global Reference Images", ja: "全体参照画像", ko: "전역 참고 이미지" },
  "(可选，支持多选)": { "zh-Hant": "（可選，支援多選）", en: "(optional, multiple allowed)", ja: "（任意、複数可）", ko: "(선택, 복수 선택 가능)" },
  "点击或拖拽上传参考图（可多选）": { "zh-Hant": "點擊或拖曳上傳參考圖（可多選）", en: "Click or drag to upload reference images", ja: "クリックまたはドラッグで参照画像をアップロード", ko: "클릭하거나 드래그하여 참고 이미지 업로드" },
  "输出尺寸与参考图一致": { "zh-Hant": "輸出尺寸與參考圖一致", en: "Match output size to reference", ja: "出力サイズを参照画像に合わせる", ko: "출력 크기를 참고 이미지와 일치" },
  "全局分辨率": { "zh-Hant": "全域解析度", en: "Global Resolution", ja: "全体解像度", ko: "전역 해상도" },
  "横版 3:2": { "zh-Hant": "橫版 3:2", en: "Landscape 3:2", ja: "横長 3:2", ko: "가로 3:2" },
  "竖版 2:3": { "zh-Hant": "直版 2:3", en: "Portrait 2:3", ja: "縦長 2:3", ko: "세로 2:3" },
  "自定义": { "zh-Hant": "自訂", en: "Custom", ja: "カスタム", ko: "사용자 지정" },
  "宽": { "zh-Hant": "寬", en: "W", ja: "幅", ko: "너비" },
  "高": { "zh-Hant": "高", en: "H", ja: "高さ", ko: "높이" },
  "生成数量": { "zh-Hant": "生成數量", en: "Image Count", ja: "生成数", ko: "생성 수" },
  "1 张": { "zh-Hant": "1 張", en: "1 image", ja: "1 枚", ko: "1장" },
  "2 张": { "zh-Hant": "2 張", en: "2 images", ja: "2 枚", ko: "2장" },
  "3 张": { "zh-Hant": "3 張", en: "3 images", ja: "3 枚", ko: "3장" },
  "4 张": { "zh-Hant": "4 張", en: "4 images", ja: "4 枚", ko: "4장" },
  "依次生成": { "zh-Hant": "依序生成", en: "Generate sequentially", ja: "順番に生成", ko: "순차 생성" },
  "分镜列表": { "zh-Hant": "分鏡列表", en: "Panel List", ja: "コマ一覧", ko: "컷 목록" },
  "＋ 添加分镜": { "zh-Hant": "＋ 新增分鏡", en: "+ Add panel", ja: "＋ コマを追加", ko: "+ 컷 추가" },
  "清空": { "zh-Hant": "清空", en: "Clear", ja: "クリア", ko: "비우기" },
  "批量创建": { "zh-Hant": "批次建立", en: "Batch Create", ja: "一括作成", ko: "일괄 생성" },
  "设置要创建的分镜总数": { "zh-Hant": "設定要建立的分鏡總數", en: "Set total panels to create", ja: "作成するコマ数を設定", ko: "생성할 컷 수 설정" },
  "分镜数": { "zh-Hant": "分鏡數", en: "Panels", ja: "コマ数", ko: "컷 수" },
  "创建": { "zh-Hant": "建立", en: "Create", ja: "作成", ko: "생성" },
  "一键填写": { "zh-Hant": "一鍵填寫", en: "Auto Fill", ja: "自動入力", ko: "자동 입력" },
  "一键填写模板": { "zh-Hant": "一鍵填寫範本", en: "Auto-fill template", ja: "自動入力テンプレート", ko: "자동 입력 템플릿" },
  "输出分镜 N 的图片": { "zh-Hant": "輸出分鏡 N 的圖片", en: "Generate image for panel N", ja: "コマ N の画像を出力", ko: "컷 N 이미지 출력" },
  "参考图 N 加编号气泡": { "zh-Hant": "參考圖 N 加編號氣泡", en: "Add numbered bubble to reference N", ja: "参照画像 N に番号吹き出し", ko: "참고 이미지 N에 번호 말풍선" },
  "参考图 N 加文字编号": { "zh-Hant": "參考圖 N 加文字編號", en: "Add text number to reference N", ja: "参照画像 N に文字番号", ko: "참고 이미지 N에 텍스트 번호" },
  "自定义模板...": { "zh-Hant": "自訂範本...", en: "Custom template...", ja: "カスタムテンプレート...", ko: "사용자 템플릿..." },
  "填入": { "zh-Hant": "填入", en: "Fill", ja: "入力", ko: "채우기" },
  "分镜提示词": { "zh-Hant": "分鏡提示詞", en: "Panel Prompt", ja: "コマプロンプト", ko: "컷 프롬프트" },
  "分辨率": { "zh-Hant": "解析度", en: "Resolution", ja: "解像度", ko: "해상도" },
  "参考图": { "zh-Hant": "參考圖", en: "Reference", ja: "参照画像", ko: "참고 이미지" },
  "分镜提示词会拼接在全局提示词之后一起发送": { "zh-Hant": "分鏡提示詞會接在全域提示詞之後一起送出", en: "Panel prompts are appended after the global prompt", ja: "コマプロンプトは全体プロンプトの後に追加されます", ko: "컷 프롬프트는 전역 프롬프트 뒤에 함께 전송됩니다" },
  "全局提示词将拼接在每个分镜提示词前面": { "zh-Hant": "全域提示詞會接在每個分鏡提示詞前面", en: "Global prompt is prepended to every panel prompt", ja: "全体プロンプトは各コマプロンプトの前に追加されます", ko: "전역 프롬프트가 각 컷 프롬프트 앞에 추가됩니다" },
  "生成图片": { "zh-Hant": "生成圖片", en: "Generate Image", ja: "画像を生成", ko: "이미지 생성" },
  "批量生成全部分镜": { "zh-Hant": "批次生成全部分鏡", en: "Generate All Panels", ja: "全コマを一括生成", ko: "모든 컷 일괄 생성" },
  "生成中……": { "zh-Hant": "生成中……", en: "Generating...", ja: "生成中…", ko: "생성 중..." },
  "生成的图片将显示在这里": { "zh-Hant": "生成的圖片會顯示在這裡", en: "Generated images will appear here", ja: "生成画像はここに表示されます", ko: "생성된 이미지가 여기에 표시됩니다" },
  "在左侧输入提示词，点击「生成图片」开始": { "zh-Hant": "在左側輸入提示詞，點擊「生成圖片」開始", en: "Enter a prompt on the left and click Generate Image", ja: "左側にプロンプトを入力して「画像を生成」をクリック", ko: "왼쪽에 프롬프트를 입력하고 이미지 생성을 클릭하세요" },
  "正在生成中……": { "zh-Hant": "正在生成中……", en: "Generating...", ja: "生成中…", ko: "생성 중..." },
  "图片目录": { "zh-Hant": "圖片目錄", en: "Image Folder", ja: "画像フォルダー", ko: "이미지 폴더" },
  "ZIP 目录": { "zh-Hant": "ZIP 目錄", en: "ZIP Folder", ja: "ZIP フォルダー", ko: "ZIP 폴더" },
  "未选择": { "zh-Hant": "未選擇", en: "Not selected", ja: "未選択", ko: "선택 안 함" },
  "压缩包名称（可选）…": { "zh-Hant": "壓縮包名稱（可選）…", en: "ZIP name (optional)...", ja: "ZIP 名（任意）…", ko: "ZIP 이름(선택)..." },
  "打包下载 ZIP": { "zh-Hant": "打包下載 ZIP", en: "Download ZIP", ja: "ZIP でダウンロード", ko: "ZIP 다운로드" },
  "清空结果": { "zh-Hant": "清空結果", en: "Clear Results", ja: "結果をクリア", ko: "결과 비우기" },
  "准备下载…": { "zh-Hant": "準備下載…", en: "Preparing download...", ja: "ダウンロード準備中…", ko: "다운로드 준비 중..." },
  "下载路径": { "zh-Hant": "下載路徑", en: "Download Paths", ja: "ダウンロード先", ko: "다운로드 경로" },
  "安卓端会调用系统目录选择器并持久授权；电脑浏览器端使用浏览器默认下载目录。": { "zh-Hant": "Android 端會呼叫系統目錄選擇器並持久授權；電腦瀏覽器端使用瀏覽器預設下載目錄。", en: "Android uses the system folder picker with persistent permission. Desktop browsers use the default download folder.", ja: "Android ではシステムのフォルダー選択を使い、権限を保持します。PC ブラウザーでは既定のダウンロード先を使います。", ko: "Android는 시스템 폴더 선택기와 영구 권한을 사용합니다. PC 브라우저는 기본 다운로드 폴더를 사용합니다." },
  "图片保存目录": { "zh-Hant": "圖片儲存目錄", en: "Image save folder", ja: "画像保存先", ko: "이미지 저장 폴더" },
  "压缩包保存目录": { "zh-Hant": "壓縮包儲存目錄", en: "ZIP save folder", ja: "ZIP 保存先", ko: "ZIP 저장 폴더" },
  "选择目录": { "zh-Hant": "選擇目錄", en: "Choose Folder", ja: "フォルダー選択", ko: "폴더 선택" },
  "历史记录": { "zh-Hant": "歷史記錄", en: "History", ja: "履歴", ko: "기록" },
  "自动保存成功生成的图片记录": { "zh-Hant": "自動儲存成功生成的圖片記錄", en: "Automatically save successful generations", ja: "成功した生成画像を自動保存", ko: "성공한 생성 기록 자동 저장" },
  "最多保留记录数": { "zh-Hant": "最多保留記錄數", en: "Maximum records", ja: "最大保存件数", ko: "최대 기록 수" },
  "清空全部记录": { "zh-Hant": "清空全部記錄", en: "Clear All Records", ja: "全履歴を消去", ko: "모든 기록 삭제" },
  "生图记录": { "zh-Hant": "生圖記錄", en: "Generation History", ja: "生成履歴", ko: "생성 기록" },
  "按日期倒序排列，数据保存在本机 localStorage。": { "zh-Hant": "依日期倒序排列，資料儲存在本機 localStorage。", en: "Sorted by date descending. Data is stored in localStorage.", ja: "日付の降順で表示。データは localStorage に保存されます。", ko: "날짜 내림차순으로 정렬되며 localStorage에 저장됩니다." },
  "搜索提示词 / 模型 / 日期": { "zh-Hant": "搜尋提示詞 / 模型 / 日期", en: "Search prompt / model / date", ja: "プロンプト / モデル / 日付を検索", ko: "프롬프트 / 모델 / 날짜 검색" },
  "刷新": { "zh-Hant": "重新整理", en: "Refresh", ja: "更新", ko: "새로고침" },
  "该分镜的专属提示词…": { "zh-Hant": "該分鏡的專屬提示詞…", en: "Prompt for this panel...", ja: "このコマ専用のプロンプト…", ko: "이 컷 전용 프롬프트..." },
  "上传参考图": { "zh-Hant": "上傳參考圖", en: "Upload reference", ja: "参照画像をアップロード", ko: "참고 이미지 업로드" },
  "清除": { "zh-Hant": "清除", en: "Remove", ja: "削除", ko: "제거" },
  "下载": { "zh-Hant": "下載", en: "Download", ja: "ダウンロード", ko: "다운로드" },
  "复制链接": { "zh-Hant": "複製連結", en: "Copy Link", ja: "リンクをコピー", ko: "링크 복사" },
  "重试": { "zh-Hant": "重試", en: "Retry", ja: "再試行", ko: "재시도" },
  "编辑重试": { "zh-Hant": "編輯重試", en: "Edit & Retry", ja: "編集して再試行", ko: "편집 후 재시도" },
  "一键重试": { "zh-Hant": "一鍵重試", en: "Retry", ja: "再試行", ko: "재시도" },
  "编辑后重试": { "zh-Hant": "編輯後重試", en: "Edit & Retry", ja: "編集して再試行", ko: "편집 후 재시도" },
  "失败": { "zh-Hant": "失敗", en: "Failed", ja: "失敗", ko: "실패" },
  "图片加载中…": { "zh-Hant": "圖片載入中…", en: "Loading image...", ja: "画像を読み込み中…", ko: "이미지 로딩 중..." },
  "图片链接暂时无法预览": { "zh-Hant": "圖片連結暫時無法預覽", en: "Image link cannot be previewed right now", ja: "画像リンクは現在プレビューできません", ko: "이미지 링크를 현재 미리 볼 수 없습니다" },
  "恢复": { "zh-Hant": "恢復", en: "Restore", ja: "復元", ko: "복원" },
  "暂无生图记录": { "zh-Hant": "暫無生圖記錄", en: "No generation history", ja: "生成履歴はありません", ko: "생성 기록 없음" },
  "展开全部": { "zh-Hant": "展開全部", en: "Expand", ja: "すべて展開", ko: "전체 펼치기" },
  "收起": { "zh-Hant": "收起", en: "Collapse", ja: "閉じる", ko: "접기" },
  "自动重试": { "zh-Hant": "自動重試", en: "Auto Retry", ja: "自動再試行", ko: "자동 재시도" },
  "全局重试次数": { "zh-Hant": "全域重試次數", en: "Global retries", ja: "全体再試行回数", ko: "전역 재시도 횟수" },
  "只有 HTTP 400 会自动重试；0 表示不自动重试。分镜里的重试次数可覆盖这里。": { "zh-Hant": "只有 HTTP 400 會自動重試；0 表示不自動重試。分鏡裡的重試次數可覆蓋這裡。", en: "Only HTTP 400 retries automatically. 0 disables auto retry. Per-panel retries override this.", ja: "HTTP 400 のみ自動再試行します。0 は自動再試行なし。各コマの回数で上書きできます。", ko: "HTTP 400만 자동 재시도됩니다. 0은 자동 재시도 없음입니다. 컷별 횟수로 덮어쓸 수 있습니다." },
  "重试": { "zh-Hant": "重試", en: "Retry", ja: "再試行", ko: "재시도" },
  "继承": { "zh-Hant": "繼承", en: "Inherit", ja: "継承", ko: "상속" },
  "该分镜自动重试次数，留空继承全局": { "zh-Hant": "該分鏡自動重試次數，留空繼承全域", en: "Auto retries for this panel. Leave empty to inherit global.", ja: "このコマの自動再試行回数。空欄なら全体設定を使用。", ko: "이 컷의 자동 재시도 횟수입니다. 비워두면 전역 설정을 따릅니다." },
  "重新加载图片": { "zh-Hant": "重新載入圖片", en: "Reload image", ja: "画像を再読み込み", ko: "이미지 다시 로드" },
  "图片重新加载中…": { "zh-Hant": "圖片重新載入中…", en: "Reloading image...", ja: "画像を再読み込み中…", ko: "이미지 다시 로드 중..." },
  "重载失败，仍无法预览": { "zh-Hant": "重載失敗，仍無法預覽", en: "Reload failed. Preview is still unavailable.", ja: "再読み込みに失敗しました。まだプレビューできません。", ko: "다시 로드하지 못했습니다. 아직 미리 볼 수 없습니다." },
  "漫画项目": { "zh-Hant": "漫畫專案", en: "Comic Project", ja: "漫画プロジェクト", ko: "만화 프로젝트" },
  "恢复项目": { "zh-Hant": "恢復專案", en: "Restore Project", ja: "プロジェクトを復元", ko: "프로젝트 복원" },
  "无提示词": { "zh-Hant": "無提示詞", en: "No prompt", ja: "プロンプトなし", ko: "프롬프트 없음" },
};

const I18N_PATTERNS = [
  [/^分镜 (\d+)$/, "分镜 {1}", { "zh-Hant": "分鏡 {1}", en: "Panel {1}", ja: "コマ {1}", ko: "컷 {1}" }],
  [/^图片 (\d+)$/, "图片 {1}", { "zh-Hant": "圖片 {1}", en: "Image {1}", ja: "画像 {1}", ko: "이미지 {1}" }],
  [/^参考图 (\d+): (.+)$/, "参考图 {1}: {2}", { "zh-Hant": "參考圖 {1}: {2}", en: "Reference {1}: {2}", ja: "参照画像 {1}: {2}", ko: "참고 이미지 {1}: {2}" }],
  [/^已加载 (\d+) 个模型，点击选择$/, "已加载 {1} 个模型，点击选择", { "zh-Hant": "已載入 {1} 個模型，點擊選擇", en: "{1} models loaded. Click to choose.", ja: "{1} 個のモデルを読み込みました。クリックして選択", ko: "{1}개 모델 로드됨. 클릭하여 선택" }],
  [/^已加载 (\d+) 个生图模型，点击选择$/, "已加载 {1} 个生图模型，点击选择", { "zh-Hant": "已載入 {1} 個生圖模型，點擊選擇", en: "{1} image models loaded. Click to choose.", ja: "{1} 個の画像モデルを読み込みました。クリックして選択", ko: "{1}개 이미지 모델 로드됨. 클릭하여 선택" }],
];

const I18N_REVERSE = new Map();
for (const [source, translations] of Object.entries(I18N)) {
  I18N_REVERSE.set(source, source);
  for (const value of Object.values(translations)) I18N_REVERSE.set(value, source);
}

const CLEAN_LOCALES = {
  "zh-CN": {
    langZh: "简体", langHant: "繁体", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI 图片生成器", subtitle: "单图生成 · 漫画分镜批量生成",
    web: "Web/PWA", desktop: "桌面", android: "安卓",
    create: "创作", panels: "分镜", history: "历史", export: "导出", settings: "设置",
    apiSettings: "API 配置", savedApis: "已保存的 API", manualApi: "手动填写",
    apiUrl: "API 地址", model: "模型", detect: "检测", proxy: "电脑端代理地址", saveConfig: "保存配置",
    connectApi: "接入 API", apiDetect: "检测", apiConnected: "API 已接入", apiDisconnected: "API 未接入",
    apiConnectHint: "点击接入 API 后填写地址、Key 和模型",
    singleMode: "单图模式", comicMode: "漫画分镜", prompt: "提示词", globalPrompt: "全局提示词",
    globalPromptComic: "全局提示词（注入所有分镜）", importTxt: "导入 txt",
    promptPlaceholder: "描述你想生成的图片，越详细越好……\n\n例如：一只橘猫坐在窗台上，阳光透过纱帘洒在它身上，油画风格，暖色调",
    globalRefs: "全局参考图片（可选，支持多选）", uploadRefs: "点击或拖拽上传参考图（可多选）",
    matchSize: "输出尺寸与参考图一致", resolution: "全局分辨率", landscape: "横版 3:2", portrait: "竖版 2:3",
    custom: "自定义", width: "宽", height: "高", imageCount: "生成数量", sequential: "依次生成",
    panelList: "分镜列表", addPanel: "添加分镜", clear: "清空", batchCreate: "批量创建", panelCount: "分镜数",
    createBtn: "创建", autoFill: "一键填写", fill: "填入", panelPrompt: "分镜提示词", retry: "重试",
    reference: "参考图", generateImage: "生成图片", generateAll: "批量生成全部分镜",
    imageFolder: "图片目录", zipFolder: "ZIP 目录", notSelected: "未选择", zipName: "压缩包名称（可选）…",
    downloadZip: "打包下载 ZIP", clearResults: "清空结果", emptyTitle: "生成的图片将显示在这里",
    emptyHint: "在左侧输入提示词，点击「生成图片」开始", downloadPaths: "下载路径",
    imageSaveFolder: "图片保存目录", zipSaveFolder: "压缩包保存目录", chooseFolder: "选择目录",
    historyTitle: "生图记录", historyHint: "漫画会按项目保存，默认折叠提示词，数据保存在本机 localStorage。",
    searchHistory: "搜索提示词 / 模型 / 日期", refresh: "刷新", autoSaveHistory: "自动保存成功生成的图片记录",
    maxRecords: "最多保留记录数", clearAllHistory: "清空全部记录", autoRetry: "自动重试", globalRetries: "全局重试次数",
    retryHint: "只有 HTTP 400 会自动重试；0 表示不自动重试。分镜里的重试次数可覆盖这里。",
    restoreProject: "恢复项目", downloadProject: "导出项目", viewPrompts: "查看提示词与分镜",
    globalPromptLabel: "全局提示词", panelLabel: "分镜", noPrompt: "无提示词", comicProject: "漫画项目",
    noHistory: "暂无生图记录", expand: "展开全部", collapse: "收起",
    noImagesToExport: "没有可导出的图片", exportOpenedHistory: "当前结果为空，已打开历史记录，可在项目卡片点击「导出项目」", packaging: "打包中……", preparingZip: "准备打包 ZIP…",
    collectingImages: "收集图片", compressing: "生成 ZIP", zipSaved: "ZIP 已保存", exportFailed: "导出失败",
    download: "下载", copyLink: "复制链接", editRetry: "编辑重试", reloadImage: "重新加载图片",
    failReason: "失败原因", retryFailedAll: "全部失败重试", failedRetryCount: "失败重试次数", noFailedToRetry: "没有可重试的失败分镜"
  },
  "zh-Hant": {
    langZh: "簡體", langHant: "繁體", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI 圖片生成器", subtitle: "單圖生成 · 漫畫分鏡批次生成",
    web: "Web/PWA", desktop: "桌面", android: "安卓",
    create: "創作", panels: "分鏡", history: "歷史", export: "匯出", settings: "設定",
    apiSettings: "API 設定", savedApis: "已儲存的 API", manualApi: "手動填寫",
    apiUrl: "API 位址", model: "模型", detect: "偵測", proxy: "桌面代理位址", saveConfig: "儲存設定",
    connectApi: "接入 API", apiDetect: "偵測", apiConnected: "API 已接入", apiDisconnected: "API 未接入",
    apiConnectHint: "點擊接入 API 後填寫位址、Key 和模型",
    singleMode: "單圖模式", comicMode: "漫畫分鏡", prompt: "提示詞", globalPrompt: "全域提示詞",
    globalPromptComic: "全域提示詞（套用到所有分鏡）", importTxt: "匯入 txt",
    promptPlaceholder: "描述你想生成的圖片，越詳細越好……\n\n例如：一隻橘貓坐在窗台上，陽光透過紗簾灑在牠身上，油畫風格，暖色調",
    globalRefs: "全域參考圖片（可選，支援多選）", uploadRefs: "點擊或拖曳上傳參考圖（可多選）",
    matchSize: "輸出尺寸與參考圖一致", resolution: "全域解析度", landscape: "橫版 3:2", portrait: "直版 2:3",
    custom: "自訂", width: "寬", height: "高", imageCount: "生成數量", sequential: "依序生成",
    panelList: "分鏡列表", addPanel: "新增分鏡", clear: "清空", batchCreate: "批次建立", panelCount: "分鏡數",
    createBtn: "建立", autoFill: "一鍵填寫", fill: "填入", panelPrompt: "分鏡提示詞", retry: "重試",
    reference: "參考圖", generateImage: "生成圖片", generateAll: "批次生成全部分鏡",
    imageFolder: "圖片目錄", zipFolder: "ZIP 目錄", notSelected: "未選擇", zipName: "壓縮包名稱（可選）…",
    downloadZip: "打包下載 ZIP", clearResults: "清空結果", emptyTitle: "生成的圖片將顯示在這裡",
    emptyHint: "在左側輸入提示詞，點擊「生成圖片」開始", downloadPaths: "下載路徑",
    imageSaveFolder: "圖片儲存目錄", zipSaveFolder: "壓縮包儲存目錄", chooseFolder: "選擇目錄",
    historyTitle: "生圖記錄", historyHint: "漫畫會按專案保存，預設摺疊提示詞，資料保存在本機 localStorage。",
    searchHistory: "搜尋提示詞 / 模型 / 日期", refresh: "重新整理", autoSaveHistory: "自動保存成功生成的圖片記錄",
    maxRecords: "最多保留記錄數", clearAllHistory: "清空全部記錄", autoRetry: "自動重試", globalRetries: "全域重試次數",
    retryHint: "只有 HTTP 400 會自動重試；0 表示不自動重試。分鏡中的重試次數可覆蓋這裡。",
    restoreProject: "恢復專案", downloadProject: "匯出專案", viewPrompts: "查看提示詞與分鏡",
    globalPromptLabel: "全域提示詞", panelLabel: "分鏡", noPrompt: "無提示詞", comicProject: "漫畫專案",
    noHistory: "暫無生圖記錄", expand: "展開全部", collapse: "收起",
    noImagesToExport: "沒有可匯出的圖片", exportOpenedHistory: "目前結果為空，已開啟歷史記錄，可在專案卡片點擊「匯出專案」", packaging: "打包中……", preparingZip: "準備打包 ZIP…",
    collectingImages: "收集圖片", compressing: "生成 ZIP", zipSaved: "ZIP 已保存", exportFailed: "匯出失敗",
    download: "下載", copyLink: "複製連結", editRetry: "編輯重試", reloadImage: "重新載入圖片",
    failReason: "失敗原因", retryFailedAll: "全部失敗重試", failedRetryCount: "失敗重試次數", noFailedToRetry: "沒有可重試的失敗分鏡"
  },
  en: {
    langZh: "简体", langHant: "繁體", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI Image Generator", subtitle: "Single images · Batch comic storyboards",
    web: "Web/PWA", desktop: "Desktop", android: "Android",
    create: "Create", panels: "Panels", history: "History", export: "Export", settings: "Settings",
    apiSettings: "API Settings", savedApis: "Saved APIs", manualApi: "Manual entry",
    apiUrl: "API URL", model: "Model", detect: "Detect", proxy: "Desktop proxy URL", saveConfig: "Save config",
    connectApi: "Connect API", apiDetect: "Detect", apiConnected: "API connected", apiDisconnected: "API not connected",
    apiConnectHint: "Connect an API, then enter URL, key, and model",
    singleMode: "Single Image", comicMode: "Comic Panels", prompt: "Prompt", globalPrompt: "Global Prompt",
    globalPromptComic: "Global Prompt (applied to all panels)", importTxt: "Import txt",
    promptPlaceholder: "Describe the image you want to generate. More detail is better...\n\nExample: an orange cat on a windowsill, sunlight through sheer curtains, oil painting style, warm tones",
    globalRefs: "Global reference images (optional, multiple)", uploadRefs: "Click or drag to upload reference images",
    matchSize: "Match output size to reference", resolution: "Global Resolution", landscape: "Landscape 3:2", portrait: "Portrait 2:3",
    custom: "Custom", width: "W", height: "H", imageCount: "Image Count", sequential: "Generate sequentially",
    panelList: "Panel List", addPanel: "Add Panel", clear: "Clear", batchCreate: "Batch Create", panelCount: "Panels",
    createBtn: "Create", autoFill: "Auto Fill", fill: "Fill", panelPrompt: "Panel Prompt", retry: "Retry",
    reference: "Reference", generateImage: "Generate Image", generateAll: "Generate All Panels",
    imageFolder: "Image Folder", zipFolder: "ZIP Folder", notSelected: "Not selected", zipName: "ZIP name (optional)...",
    downloadZip: "Download ZIP", clearResults: "Clear Results", emptyTitle: "Generated images will appear here",
    emptyHint: "Enter a prompt on the left and click Generate Image", downloadPaths: "Download Paths",
    imageSaveFolder: "Image save folder", zipSaveFolder: "ZIP save folder", chooseFolder: "Choose Folder",
    historyTitle: "Generation History", historyHint: "Comics are saved as projects. Prompts stay collapsed by default and data is stored in localStorage.",
    searchHistory: "Search prompt / model / date", refresh: "Refresh", autoSaveHistory: "Automatically save successful generations",
    maxRecords: "Maximum records", clearAllHistory: "Clear All Records", autoRetry: "Auto Retry", globalRetries: "Global retries",
    retryHint: "Only HTTP 400 retries automatically. 0 disables auto retry. Per-panel retries override this.",
    restoreProject: "Restore Project", downloadProject: "Export Project", viewPrompts: "View prompts and panels",
    globalPromptLabel: "Global Prompt", panelLabel: "Panel", noPrompt: "No prompt", comicProject: "Comic Project",
    noHistory: "No generation history", expand: "Expand", collapse: "Collapse",
    noImagesToExport: "No images to export", exportOpenedHistory: "Current results are empty. History is open; use Export Project on a project card.", packaging: "Packaging...", preparingZip: "Preparing ZIP...",
    collectingImages: "Collecting images", compressing: "Creating ZIP", zipSaved: "ZIP saved", exportFailed: "Export failed",
    download: "Download", copyLink: "Copy Link", editRetry: "Edit & Retry", reloadImage: "Reload image",
    failReason: "Failure reason", retryFailedAll: "Retry all failed", failedRetryCount: "Failed retry attempts", noFailedToRetry: "No failed panels to retry"
  },
  ja: {
    langZh: "简体", langHant: "繁體", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI 画像生成", subtitle: "単体画像 · 漫画ストーリーボード一括生成",
    web: "Web/PWA", desktop: "デスクトップ", android: "Android",
    create: "作成", panels: "絵コンテ", history: "履歴", export: "書き出し", settings: "設定",
    apiSettings: "API 設定", savedApis: "保存済み API", manualApi: "手動入力",
    apiUrl: "API URL", model: "モデル", detect: "検出", proxy: "デスクトッププロキシ URL", saveConfig: "設定を保存",
    connectApi: "API 接続", apiDetect: "検出", apiConnected: "API 接続済み", apiDisconnected: "API 未接続",
    apiConnectHint: "API 接続後、URL、Key、モデルを入力してください",
    singleMode: "単体画像", comicMode: "漫画コマ", prompt: "プロンプト", globalPrompt: "全体プロンプト",
    globalPromptComic: "全体プロンプト（全コマに適用）", importTxt: "txt を読み込む",
    promptPlaceholder: "生成したい画像を詳しく説明してください...\n\n例：窓辺のオレンジ色の猫、薄いカーテン越しの光、油絵風、暖色",
    globalRefs: "全体参考画像（任意・複数可）", uploadRefs: "クリックまたはドラッグで参考画像をアップロード",
    matchSize: "出力サイズを参考画像に合わせる", resolution: "全体解像度", landscape: "横 3:2", portrait: "縦 2:3",
    custom: "カスタム", width: "幅", height: "高", imageCount: "生成数", sequential: "順番に生成",
    panelList: "コマ一覧", addPanel: "コマを追加", clear: "クリア", batchCreate: "一括作成", panelCount: "コマ数",
    createBtn: "作成", autoFill: "自動入力", fill: "入力", panelPrompt: "コマプロンプト", retry: "再試行",
    reference: "参考", generateImage: "画像を生成", generateAll: "全コマを生成",
    imageFolder: "画像フォルダ", zipFolder: "ZIP フォルダ", notSelected: "未選択", zipName: "ZIP 名（任意）...",
    downloadZip: "ZIP ダウンロード", clearResults: "結果をクリア", emptyTitle: "生成画像はここに表示されます",
    emptyHint: "左側にプロンプトを入力し、生成を開始してください", downloadPaths: "保存先",
    imageSaveFolder: "画像保存先", zipSaveFolder: "ZIP 保存先", chooseFolder: "フォルダ選択",
    historyTitle: "生成履歴", historyHint: "漫画はプロジェクトとして保存され、プロンプトは初期状態で折りたたまれます。",
    searchHistory: "プロンプト / モデル / 日付を検索", refresh: "更新", autoSaveHistory: "成功した生成を自動保存",
    maxRecords: "最大記録数", clearAllHistory: "すべて削除", autoRetry: "自動再試行", globalRetries: "全体再試行回数",
    retryHint: "HTTP 400 のみ自動再試行します。0 は無効。コマごとの設定が優先されます。",
    restoreProject: "プロジェクト復元", downloadProject: "プロジェクト書き出し", viewPrompts: "プロンプトとコマを見る",
    globalPromptLabel: "全体プロンプト", panelLabel: "コマ", noPrompt: "プロンプトなし", comicProject: "漫画プロジェクト",
    noHistory: "生成履歴はありません", expand: "展開", collapse: "折りたたむ",
    noImagesToExport: "書き出せる画像がありません", exportOpenedHistory: "現在の結果は空です。履歴を開いたので、プロジェクトカードの書き出しを使ってください。", packaging: "パッケージ中...", preparingZip: "ZIP 準備中...",
    collectingImages: "画像を収集中", compressing: "ZIP 作成中", zipSaved: "ZIP 保存済み", exportFailed: "書き出し失敗",
    download: "ダウンロード", copyLink: "リンクをコピー", editRetry: "編集して再試行", reloadImage: "画像を再読み込み",
    failReason: "失敗理由", retryFailedAll: "失敗分を再試行", failedRetryCount: "失敗時の再試行回数", noFailedToRetry: "再試行できる失敗コマはありません"
  },
  ko: {
    langZh: "简体", langHant: "繁體", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI 이미지 생성기", subtitle: "단일 이미지 · 만화 콘티 일괄 생성",
    web: "Web/PWA", desktop: "데스크톱", android: "Android",
    create: "생성", panels: "콘티", history: "기록", export: "내보내기", settings: "설정",
    apiSettings: "API 설정", savedApis: "저장된 API", manualApi: "직접 입력",
    apiUrl: "API URL", model: "모델", detect: "감지", proxy: "데스크톱 프록시 URL", saveConfig: "설정 저장",
    connectApi: "API 연결", apiDetect: "감지", apiConnected: "API 연결됨", apiDisconnected: "API 미연결",
    apiConnectHint: "API를 연결한 뒤 URL, Key, 모델을 입력하세요",
    singleMode: "단일 이미지", comicMode: "만화 콘티", prompt: "프롬프트", globalPrompt: "전체 프롬프트",
    globalPromptComic: "전체 프롬프트(모든 콘티에 적용)", importTxt: "txt 가져오기",
    promptPlaceholder: "생성할 이미지를 자세히 설명하세요...\n\n예: 창가에 앉은 주황색 고양이, 커튼 사이로 비치는 햇빛, 유화 스타일, 따뜻한 톤",
    globalRefs: "전체 참고 이미지(선택, 다중)", uploadRefs: "클릭하거나 드래그해 참고 이미지 업로드",
    matchSize: "출력 크기를 참고 이미지와 맞춤", resolution: "전체 해상도", landscape: "가로 3:2", portrait: "세로 2:3",
    custom: "사용자 지정", width: "너비", height: "높이", imageCount: "생성 수", sequential: "순차 생성",
    panelList: "콘티 목록", addPanel: "콘티 추가", clear: "비우기", batchCreate: "일괄 생성", panelCount: "콘티 수",
    createBtn: "생성", autoFill: "자동 입력", fill: "입력", panelPrompt: "콘티 프롬프트", retry: "재시도",
    reference: "참고", generateImage: "이미지 생성", generateAll: "모든 콘티 생성",
    imageFolder: "이미지 폴더", zipFolder: "ZIP 폴더", notSelected: "선택 안 됨", zipName: "ZIP 이름(선택)...",
    downloadZip: "ZIP 다운로드", clearResults: "결과 비우기", emptyTitle: "생성된 이미지가 여기에 표시됩니다",
    emptyHint: "왼쪽에 프롬프트를 입력하고 생성 버튼을 누르세요", downloadPaths: "다운로드 경로",
    imageSaveFolder: "이미지 저장 폴더", zipSaveFolder: "ZIP 저장 폴더", chooseFolder: "폴더 선택",
    historyTitle: "생성 기록", historyHint: "만화는 프로젝트로 저장되며 프롬프트는 기본적으로 접혀 있습니다.",
    searchHistory: "프롬프트 / 모델 / 날짜 검색", refresh: "새로고침", autoSaveHistory: "성공한 생성 자동 저장",
    maxRecords: "최대 기록 수", clearAllHistory: "모든 기록 삭제", autoRetry: "자동 재시도", globalRetries: "전체 재시도 횟수",
    retryHint: "HTTP 400만 자동 재시도합니다. 0은 비활성화입니다. 콘티별 설정이 우선합니다.",
    restoreProject: "프로젝트 복원", downloadProject: "프로젝트 내보내기", viewPrompts: "프롬프트와 콘티 보기",
    globalPromptLabel: "전체 프롬프트", panelLabel: "콘티", noPrompt: "프롬프트 없음", comicProject: "만화 프로젝트",
    noHistory: "생성 기록 없음", expand: "펼치기", collapse: "접기",
    noImagesToExport: "내보낼 이미지가 없습니다", exportOpenedHistory: "현재 결과가 비어 있어 기록을 열었습니다. 프로젝트 카드에서 프로젝트 내보내기를 사용하세요.", packaging: "패키징 중...", preparingZip: "ZIP 준비 중...",
    collectingImages: "이미지 수집 중", compressing: "ZIP 생성 중", zipSaved: "ZIP 저장됨", exportFailed: "내보내기 실패",
    download: "다운로드", copyLink: "링크 복사", editRetry: "편집 후 재시도", reloadImage: "이미지 다시 불러오기",
    failReason: "실패 원인", retryFailedAll: "실패 항목 재시도", failedRetryCount: "실패 재시도 횟수", noFailedToRetry: "재시도할 실패 콘티가 없습니다"
  }
};

function cleanText(key) {
  return CLEAN_LOCALES[currentLanguage]?.[key] || CLEAN_LOCALES["zh-CN"][key] || key;
}

function setText(selector, key, root = document) {
  const el = root.querySelector?.(selector);
  if (el) el.textContent = cleanText(key);
}

function setAttr(selector, attr, key, root = document) {
  const el = root.querySelector?.(selector);
  if (el) el.setAttribute(attr, cleanText(key));
}

function setButtonText(el, iconName, key) {
  if (!el) return;
  el.innerHTML = `${icon(iconName)} ${cleanText(key)}`;
}

function setIconLabel(selector, iconName, key, root = document) {
  const el = root.querySelector?.(selector);
  if (el) el.innerHTML = `${icon(iconName)} ${cleanText(key)}`;
}

function interpolate(text, vars = {}) {
  return String(text).replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

function templateToRegex(template) {
  const parts = String(template).split(/(\{\d+\})/g).filter(Boolean);
  const pattern = parts.map(part => {
    if (/^\{\d+\}$/.test(part)) return "(.+)";
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return new RegExp(`^${pattern}$`);
}

function fillTemplate(template, values = []) {
  let text = String(template);
  values.forEach((value, index) => {
    text = text.split(`{${index + 1}}`).join(value);
  });
  return text;
}

function normalizeI18nSource(text) {
  const direct = I18N_REVERSE.get(String(text));
  if (direct) return direct;
  const fromPattern = sourceFromPattern(text);
  return fromPattern || String(text);
}

function tr(source, vars = {}) {
  const resolved = normalizeI18nSource(source);
  if (currentLanguage === "zh-CN") return interpolate(resolved, vars);
  const translated = I18N[resolved]?.[currentLanguage] || translatePattern(resolved) || resolved;
  return interpolate(translated, vars);
}

function translatePattern(text) {
  const source = sourceFromPattern(text);
  if (source && source !== text) return translatePattern(source);
  for (const [regex, sourceTemplate, translations] of I18N_PATTERNS) {
    const match = String(text).match(regex);
    if (!match) continue;
    if (currentLanguage === "zh-CN") return fillTemplate(sourceTemplate, match.slice(1));
    return fillTemplate(translations[currentLanguage] || sourceTemplate, match.slice(1));
  }
  return null;
}

function sourceFromPattern(text) {
  const value = String(text);
  for (const [regex, sourceTemplate, translations] of I18N_PATTERNS) {
    const sourceMatch = value.match(regex);
    if (sourceMatch) return fillTemplate(sourceTemplate, sourceMatch.slice(1));
    for (const template of Object.values(translations)) {
      const match = value.match(templateToRegex(template));
      if (match) return fillTemplate(sourceTemplate, match.slice(1));
    }
  }
  return null;
}

function translateTextValue(value) {
  if (!value || !String(value).trim()) return value;
  const text = String(value);
  const trimmed = text.trim();
  const leading = text.slice(0, text.indexOf(trimmed));
  const trailing = text.slice(text.indexOf(trimmed) + trimmed.length);
  const source = normalizeI18nSource(trimmed);
  const translated = currentLanguage === "zh-CN"
    ? source
    : (I18N[source]?.[currentLanguage] || translatePattern(source));
  return translated ? `${leading}${translated}${trailing}` : value;
}

function translateElement(root = document.body) {
  if (!root || root.nodeType === Node.COMMENT_NODE) return;
  const shouldSkip = node => {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!el?.closest?.("[data-no-i18n], script, style");
  };

  if (root.nodeType === Node.TEXT_NODE) {
    if (!shouldSkip(root)) {
      const next = translateTextValue(root.nodeValue);
      if (next !== root.nodeValue) root.nodeValue = next;
    }
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

  if (!shouldSkip(root) && root.nodeType === Node.ELEMENT_NODE) {
    ["title", "placeholder", "aria-label"].forEach(attr => {
      if (!root.hasAttribute(attr)) return;
      const current = root.getAttribute(attr);
      const next = translateTextValue(current);
      if (next !== current) root.setAttribute(attr, next);
    });
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(node => {
    const next = translateTextValue(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  });

  if (root.querySelectorAll) {
    root.querySelectorAll("[title], [placeholder], [aria-label]").forEach(el => {
      if (shouldSkip(el)) return;
      ["title", "placeholder", "aria-label"].forEach(attr => {
        if (!el.hasAttribute(attr)) return;
        const current = el.getAttribute(attr);
        const next = translateTextValue(current);
        if (next !== current) el.setAttribute(attr, next);
      });
    });
  }
}

function applyCleanLanguage() {
  const langNames = {
    "zh-CN": cleanText("langZh"),
    "zh-Hant": cleanText("langHant"),
    en: cleanText("langEn"),
    ja: cleanText("langJa"),
    ko: cleanText("langKo"),
  };
  if (dom.languageSelect) {
    Object.entries(langNames).forEach(([value, label]) => {
      const option = dom.languageSelect.querySelector(`option[value="${value}"]`);
      if (option) option.textContent = label;
    });
    dom.languageSelect.title = cleanText("settings");
  }

  document.title = cleanText("appTitle");
  const appNameMeta = document.querySelector('meta[name="application-name"]');
  if (appNameMeta) appNameMeta.setAttribute("content", cleanText("appTitle"));

  const title = $(".header h1");
  if (title) {
    const mark = title.querySelector(".brand-mark");
    title.textContent = "";
    if (mark) title.appendChild(mark);
    title.appendChild(document.createTextNode(cleanText("appTitle")));
  }
  setText(".subtitle", "subtitle");

  setIconLabel("#configSection .config-toggle", "settings", "apiSettings");
  setText("#configSection .field:nth-child(1) > span", "savedApis");
  const manual = dom.savedApis?.querySelector('option[value=""]');
  if (manual) manual.textContent = cleanText("manualApi");
  setText("#configSection .field:nth-child(2) > span", "apiUrl");
  setText("#configSection .field:nth-child(4) > span", "model");
  setButtonText(dom.detectModels, "search", "detect");
  setText("#configSection .field:nth-child(5) > span", "proxy");
  setButtonText(dom.saveConfig, "save", "saveConfig");
  setButtonText(dom.openApiConfig, "settings", "connectApi");
  setButtonText(dom.quickDetectModels, "search", "apiDetect");
  updateApiQuickState();

  $$(".mode-tab", dom.modeTabs).forEach(tab => {
    setButtonText(tab, tab.dataset.mode === "comic" ? "comic" : "image", tab.dataset.mode === "comic" ? "comicMode" : "singleMode");
  });

  const isComic = currentMode === "comic";
  setText("#globalPromptField .field-label-text", isComic ? "globalPromptComic" : "prompt");
  setButtonText(dom.importTxt, "file", "importTxt");
  if (dom.prompt) dom.prompt.placeholder = cleanText("promptPlaceholder");
  setText(".image-upload .upload-zone span:last-child", "uploadRefs");
  setIconLabel("#useOrigSizeToggle > span", "size", "matchSize");
  setText("fieldset.field > legend", "resolution");
  setText(".size-option:nth-child(2) small", "landscape");
  setText(".size-option:nth-child(3) small", "portrait");
  setText(".size-custom > span:first-of-type", "custom");
  setAttr("#customWidth", "placeholder", "width");
  setAttr("#customHeight", "placeholder", "height");
  setText("#nImagesField > span", "imageCount");
  setText("#sequentialToggle > span", "sequential");

  setIconLabel("#comicPanelSection .section-header > span", "comic", "panelList");
  setButtonText(dom.addPanel, "plus", "addPanel");
  if (dom.clearPanels) dom.clearPanels.textContent = cleanText("clear");
  setText(".tool-group:nth-child(1) .tool-label", "batchCreate");
  setText(".panel-count-control > span", "panelCount");
  if (dom.createPanels) dom.createPanels.textContent = cleanText("createBtn");
  setText(".tool-group-fill .tool-label", "autoFill");
  setButtonText(dom.autoFillPanels, "spark", "fill");
  setText(".panel-table th.col-prompt", "panelPrompt");
  setText(".panel-table th.col-size", "resolution");
  setText(".panel-table th.col-retry", "retry");
  setText(".panel-table th.col-img", "reference");

  setButtonText(dom.generateBtn, "spark", isComic ? "generateAll" : "generateImage");
  setButtonText(dom.chooseImageDir, "image", "imageFolder");
  setButtonText(dom.chooseZipDir, "zip", "zipFolder");
  setButtonText(dom.downloadZip, "zip", "downloadZip");
  if (dom.clearResults) dom.clearResults.textContent = cleanText("clearResults");
  setText(".retry-failed-count span", "failedRetryCount");
  setRetryFailedButtonText();
  if (dom.zipFileName) dom.zipFileName.placeholder = cleanText("zipName");
  if (dom.imageDirLabel && dom.imageDirLabel.textContent.trim()) dom.imageDirLabel.textContent = nativeDownload?.dirs?.images ? shortPathLabel(nativeDownload.dirs.images) : cleanText("notSelected");
  if (dom.zipDirLabel && dom.zipDirLabel.textContent.trim()) dom.zipDirLabel.textContent = nativeDownload?.dirs?.zips ? shortPathLabel(nativeDownload.dirs.zips) : cleanText("notSelected");
  setText("#emptyState h3", "emptyTitle");
  setText("#emptyState p", "emptyHint");

  setText("#settingsTitle", "settings");
  setText(".download-settings h3", "downloadPaths");
  setText(".download-settings .setting-row:nth-of-type(1) strong", "imageSaveFolder");
  setText(".download-settings .setting-row:nth-of-type(2) strong", "zipSaveFolder");
  setText(".settings-section:nth-child(2) h3", "historyTitle");
  setText(".settings-section:nth-child(2) .checkbox-field span", "autoSaveHistory");
  setText(".settings-section:nth-child(2) .field span", "maxRecords");
  if (dom.clearHistory) dom.clearHistory.textContent = cleanText("clearAllHistory");
  setText(".settings-section:nth-child(3) h3", "autoRetry");
  setText(".settings-section:nth-child(3) .field span", "globalRetries");
  setText(".settings-section:nth-child(3) .field-hint", "retryHint");
  setText("#historyTitle", "historyTitle");
  setText("#historyModal .modal-header .field-hint", "historyHint");
  setAttr("#historySearch", "placeholder", "searchHistory");
  if (dom.refreshHistory) dom.refreshHistory.textContent = cleanText("refresh");
}

function applyLanguage(lang) {
  currentLanguage = SUPPORTED_LANGS.includes(lang) ? lang : "zh-CN";
  localStorage.setItem(LANG_KEY, currentLanguage);
  document.documentElement.lang = currentLanguage;
  document.title = tr("AI 图片生成器");
  if (dom.languageSelect) dom.languageSelect.value = currentLanguage;
  if (dom.languageSelect) dom.languageSelect.title = tr("界面语言");
  isApplyingLanguage = true;
  try {
    refreshLocalizedUiState();
    translateElement(document.body);
    applyCleanLanguage();
  } finally {
    isApplyingLanguage = false;
  }
}

function initI18n() {
  if (dom.languageSelect) {
    dom.languageSelect.value = currentLanguage;
    dom.languageSelect.title = tr("界面语言");
    dom.languageSelect.addEventListener("change", () => applyLanguage(dom.languageSelect.value));
  }
  applyLanguage(currentLanguage);

  const observer = new MutationObserver(mutations => {
    if (isApplyingLanguage) return;
    isApplyingLanguage = true;
    try {
      mutations.forEach(mutation => {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach(node => translateElement(node));
        } else if (mutation.type === "attributes") {
          translateElement(mutation.target);
        }
      });
    } finally {
      isApplyingLanguage = false;
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title", "placeholder", "aria-label"],
  });
}

// ─── DOM 引用 ──────────────────────────────────────────────
const dom = {
  // 配置
  apiEndpoint:   $("#apiEndpoint"),
  apiKey:        $("#apiKey"),
  model:         $("#model"),
  proxyEndpoint: $("#proxyEndpoint"),
  modelList:     $("#modelList"),
  detectModels:  $("#detectModels"),
  saveConfig:    $("#saveConfig"),
  savedApis:     $("#savedApis"),
  deleteSavedApi:$("#deleteSavedApi"),
  toggleKey:     $("#toggleKey"),
  configSection: $("#configSection"),
  apiQuickCard:  $("#apiQuickCard"),
  apiStateDot:   $("#apiStateDot"),
  apiQuickTitle: $("#apiQuickTitle"),
  apiQuickMeta:  $("#apiQuickMeta"),
  openApiConfig: $("#openApiConfig"),
  quickDetectModels: $("#quickDetectModels"),
  // 模式
  modeTabs:      $("#modeTabs"),
  sideRail:      $("#sideRail"),
  // 全局输入
  prompt:        $("#prompt"),
  importTxt:     $("#importTxt"),
  txtFileInput:  $("#txtFileInput"),
  promptHint:    $("#promptHint"),
  refImage:      $("#refImage"),
  uploadZone:    $("#uploadZone"),
  thumbGrid:     $("#thumbGrid"),
  useOrigSize:   $("#useOrigSize"),
  customWidth:   $("#customWidth"),
  customHeight:  $("#customHeight"),
  txtFileBadges: $("#txtFileBadges"),
  // 单图专属
  nImages:       $("#nImages"),
  sequentialMode:$("#sequentialMode"),
  nImagesField:  $("#nImagesField"),
  // 漫画专属
  comicSection:  $("#comicPanelSection"),
  panelCount:    $("#panelCount"),
  createPanels:  $("#createPanels"),
  addPanel:      $("#addPanel"),
  clearPanels:   $("#clearPanels"),
  panelTbody:    $("#panelTbody"),
  // 进度
  progressWrap:  $("#progressWrap"),
  progressFill:  $("#progressFill"),
  progressText:  $("#progressText"),
  // 生成
  generateBtn:   $("#generateBtn"),
  status:        $("#status"),
  // 结果
  emptyState:    $("#emptyState"),
  resultGrid:    $("#resultGrid"),
  resultToolbar: $("#resultToolbar"),
  downloadZip:   $("#downloadZip"),
  clearResults:  $("#clearResults"),
  retryFailedTools: $("#retryFailedTools"),
  retryFailedAll: $("#retryFailedAll"),
  failedRetryCount: $("#failedRetryCount"),
  loadingOverlay:$("#loadingOverlay"),
  loadingText:   $("#loadingText"),
  // ZIP & 分镜工具
  zipFileName:   $("#zipFileName"),
  chooseImageDir:$("#chooseImageDir"),
  chooseZipDir:  $("#chooseZipDir"),
  imageDirLabel: $("#imageDirLabel"),
  zipDirLabel:   $("#zipDirLabel"),
  downloadProgress: $("#downloadProgress"),
  downloadProgressFill: $("#downloadProgressFill"),
  downloadProgressText: $("#downloadProgressText"),
  autoFillPanels:$("#autoFillPanels"),
  autoFillTemplate:$("#autoFillTemplate"),
  // 主题
  themeToggle:   $("#themeToggle"),
  languageSelect:$("#languageSelect"),
  // 设置
  settingsBtn:   $("#settingsBtn"),
  settingsModal: $("#settingsModal"),
  closeSettings: $("#closeSettings"),
  settingsChooseImageDir: $("#settingsChooseImageDir"),
  settingsChooseZipDir:   $("#settingsChooseZipDir"),
  settingsImageDirLabel:  $("#settingsImageDirLabel"),
  settingsZipDirLabel:    $("#settingsZipDirLabel"),
  historyEnabled: $("#historyEnabled"),
  historyLimit:   $("#historyLimit"),
  retryCount:     $("#retryCount"),
  clearHistory:   $("#clearHistory"),
  // 历史
  historyBtn:    $("#historyBtn"),
  historyModal:  $("#historyModal"),
  closeHistory:  $("#closeHistory"),
  historySearch: $("#historySearch"),
  refreshHistory:$("#refreshHistory"),
  historyList:   $("#historyList"),
};

// ─── 状态 ──────────────────────────────────────────────────
let currentMode = "single";   // "single" | "comic"
let panelCounter = 0;         // 分镜自增编号
let abortController = null;   // 用于取消批量生成
let activeGenerationId = 0;    // 用于丢弃已取消/过期的生成结果
let importedTxtFiles = [];      // { name, content } —— 导入的多个 txt 文件
let referenceImages = [];       // { file, dataUrl, width, height } —— 多张参考图片
let generatedImageUrls = [];
let appWasBackgrounded = false;
let retryAllFailedInProgress = false;

// ─── 配置管理 ──────────────────────────────────────────────
const STORAGE_KEY = "ai_image_gen_config";

function loadConfig() {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}
function saveConfig(config) { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); }
function clearConfig() { localStorage.removeItem(STORAGE_KEY); }
function applyConfig(cfg) {
  if (cfg.endpoint) dom.apiEndpoint.value = cfg.endpoint;
  if (cfg.apiKey)   dom.apiKey.value = cfg.apiKey;
  if (cfg.model)    dom.model.value = cfg.model;
  if (cfg.proxyEndpoint) dom.proxyEndpoint.value = cfg.proxyEndpoint;
}

function currentApiConfig(name = loadConfig().name || "") {
  const endpoint = dom.apiEndpoint.value.trim();
  return {
    name: name || readableEndpoint(endpoint) || "未命名",
    endpoint,
    apiKey: dom.apiKey.value.trim(),
    model: dom.model.value.trim(),
    proxyEndpoint: dom.proxyEndpoint.value.trim(),
    platform: (findAdapter(endpoint) || {}).name || "未知",
  };
}

function maskApiKey(key) {
  if (!key) return "";
  if (key.length <= 10) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function readableEndpoint(endpoint) {
  if (!endpoint) return "";
  try {
    const normalized = /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
    return new URL(normalized).host || endpoint;
  } catch {
    return endpoint.replace(/^https?:\/\//i, "").split("/")[0] || endpoint;
  }
}

function updateApiQuickState() {
  if (!dom.apiQuickCard) return;
  const endpoint = dom.apiEndpoint?.value.trim() || "";
  const apiKey = dom.apiKey?.value.trim() || "";
  const model = dom.model?.value.trim() || "gpt-image-2";
  const connected = Boolean(endpoint && apiKey);
  dom.apiQuickCard.classList.toggle("is-connected", connected);
  if (dom.apiQuickTitle) {
    dom.apiQuickTitle.textContent = cleanText(connected ? "apiConnected" : "apiDisconnected");
  }
  if (dom.apiQuickMeta) {
    if (connected) {
      let adapter = null;
      try {
        adapter = findAdapter(endpoint);
      } catch {
        adapter = null;
      }
      const platform = adapter?.name || readableEndpoint(endpoint);
      dom.apiQuickMeta.textContent = `${platform} · ${model} · ${maskApiKey(apiKey)}`;
    } else {
      dom.apiQuickMeta.textContent = cleanText("apiConnectHint");
    }
  }
}

const STORAGE_APIS = "ai_image_gen_apis";

function loadAllApis() {
  try { return JSON.parse(localStorage.getItem(STORAGE_APIS) || "[]"); }
  catch { return []; }
}
function saveAllApis(list) { localStorage.setItem(STORAGE_APIS, JSON.stringify(list)); }

function renderSavedApis() {
  const apis = loadAllApis();
  dom.savedApis.innerHTML = `<option value="">${tr("— 手动填写 —")}</option>`;
  apis.forEach((api, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = api.name || api.endpoint;
    dom.savedApis.appendChild(opt);
  });
}

function keepApiConfigVisible() {
  if (!dom.configSection) return;
  dom.configSection.open = true;
  const panel = dom.configSection.closest(".input-panel");
  if (panel) panel.scrollTop = Math.max(0, dom.configSection.offsetTop - 8);
  dom.configSection.querySelector(".config-body")?.scrollTo?.({ top: 0 });
  dom.configSection.scrollIntoView?.({ block: "start", inline: "nearest" });
}

dom.savedApis.addEventListener("change", () => {
  const idx = dom.savedApis.value;
  if (idx === "") return;
  const apis = loadAllApis();
  const api = apis[idx];
  if (api) {
    dom.apiEndpoint.value = api.endpoint || "";
    dom.apiKey.value = api.apiKey || "";
    dom.model.value = api.model || "";
    dom.proxyEndpoint.value = api.proxyEndpoint || "";
    saveConfig(api);
    showStatus(`已切换: ${api.name || api.endpoint}`, "info");
    updateApiQuickState();
  }
});

dom.saveConfig.addEventListener("click", () => {
  const name = prompt("给这个配置起个名字（如：huanapi / GrsAI）：", "");
  if (name === null) return;
  const cfg = currentApiConfig(name || "未命名");
  const apis = loadAllApis();
  const existIdx = apis.findIndex(a => a.name === cfg.name);
  const selectedIdx = existIdx >= 0 ? existIdx : apis.length;
  if (existIdx >= 0) apis[existIdx] = cfg;
  else apis.push(cfg);
  saveAllApis(apis);
  saveConfig(cfg);
  renderSavedApis();
  dom.savedApis.value = String(selectedIdx);
  showStatus(`已保存: ${cfg.name} ✅`, "success");
  keepApiConfigVisible();
  updateApiQuickState();
});

dom.deleteSavedApi.addEventListener("click", () => {
  const idx = parseInt(dom.savedApis.value);
  if (isNaN(idx)) return;
  const apis = loadAllApis();
  const deleted = apis[idx];
  const name = deleted?.name;
  if (!confirm(`删除配置「${name}」?`)) return;
  apis.splice(idx, 1);
  saveAllApis(apis);
  dom.savedApis.value = "";
  renderSavedApis();
  const active = loadConfig();
  const deletingActive = deleted && (
    active.name === deleted.name ||
    (active.endpoint && active.endpoint === deleted.endpoint && active.apiKey === deleted.apiKey)
  );
  if (deletingActive) {
    clearConfig();
    dom.apiEndpoint.value = "";
    dom.apiKey.value = "";
    dom.model.value = "";
    dom.proxyEndpoint.value = "";
  }
  showStatus(`已删除: ${name}`, "info");
  updateApiQuickState();
});

// 初始化
const config = loadConfig();
applyConfig(config);
renderSavedApis();
dom.configSection.open = false;
updateApiQuickState();

dom.openApiConfig?.addEventListener("click", () => {
  keepApiConfigVisible();
  dom.apiEndpoint?.focus();
});

dom.quickDetectModels?.addEventListener("click", () => {
  keepApiConfigVisible();
  dom.detectModels?.click();
});

[dom.apiEndpoint, dom.apiKey, dom.model, dom.proxyEndpoint].forEach(input => {
  input?.addEventListener("input", updateApiQuickState);
  input?.addEventListener("change", updateApiQuickState);
});

// ─── 主题切换 ──────────────────────────────────────────────
const THEME_KEY = "ai_image_gen_theme";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  dom.themeToggle.innerHTML = icon(theme === "light" ? "sun" : "moon");
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute("content", theme === "light" ? "#f5f6f1" : "#101310");
  localStorage.setItem(THEME_KEY, theme);
}

// 初始化主题（默认深色）
const savedTheme = localStorage.getItem(THEME_KEY) || "dark";
applyTheme(savedTheme);

dom.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "light" ? "dark" : "light");
});

// ─── 应用设置 / 弹层 ─────────────────────────────────────────
const SETTINGS_KEY = "ai_image_gen_settings";

function loadSettings() {
  try {
    return {
      historyEnabled: true,
      historyLimit: 100,
      retryCount: 3,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
    };
  } catch {
    return { historyEnabled: true, historyLimit: 100, retryCount: 3 };
  }
}

function saveSettings(next = {}) {
  const current = loadSettings();
  const merged = { ...current, ...next };
  merged.historyLimit = Math.min(500, Math.max(20, Number(merged.historyLimit) || 100));
  merged.retryCount = clampRetryCount(merged.retryCount);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  applySettings(merged);
  return merged;
}

function applySettings(settings = loadSettings()) {
  if (dom.historyEnabled) dom.historyEnabled.checked = settings.historyEnabled !== false;
  if (dom.historyLimit) dom.historyLimit.value = String(settings.historyLimit || 100);
  if (dom.retryCount) dom.retryCount.value = String(clampRetryCount(settings.retryCount));
  if (dom.failedRetryCount && !dom.failedRetryCount.dataset.edited) {
    dom.failedRetryCount.value = String(clampRetryCount(settings.retryCount));
  }
}

function clampRetryCount(value, fallback = 3) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(10, Math.max(0, Math.floor(num)));
}

function getGlobalRetryCount() {
  return clampRetryCount(loadSettings().retryCount);
}

function openModal(modal) {
  modal?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal(modal) {
  modal?.classList.add("hidden");
  if (!dom.settingsModal?.classList.contains("hidden") || !dom.historyModal?.classList.contains("hidden")) return;
  document.body.style.overflow = "";
}

dom.settingsBtn?.addEventListener("click", () => openModal(dom.settingsModal));
dom.closeSettings?.addEventListener("click", () => closeModal(dom.settingsModal));
dom.settingsModal?.addEventListener("click", e => { if (e.target === dom.settingsModal) closeModal(dom.settingsModal); });
dom.historyEnabled?.addEventListener("change", () => saveSettings({ historyEnabled: dom.historyEnabled.checked }));
dom.historyLimit?.addEventListener("change", () => saveSettings({ historyLimit: dom.historyLimit.value }));
dom.retryCount?.addEventListener("change", () => saveSettings({ retryCount: dom.retryCount.value }));
dom.failedRetryCount?.addEventListener("input", () => { dom.failedRetryCount.dataset.edited = "true"; });
dom.failedRetryCount?.addEventListener("change", getFailedRetryCount);
dom.retryFailedAll?.addEventListener("click", retryAllFailedResults);
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  closeModal(dom.settingsModal);
  closeModal(dom.historyModal);
});
applySettings();

// ─── 已知模型价格（跨平台通用） ─────────────────────────────
const KNOWN_PRICES = {
  "gpt-image-2-vip": "¥0.065~0.13/次", "gpt-image-2": "¥0.03~0.06/次",
  "nano-banana-fast": "¥0.022~0.044/次", "nano-banana": "¥0.07~0.14/次",
  "nano-banana-2": "¥0.06~0.12/次", "nano-banana-2-cl": "¥0.08~0.16/次",
  "nano-banana-2-4k-cl": "¥0.15~0.3/次",
  "nano-banana-pro": "¥0.09~0.18/次", "nano-banana-pro-vt": "¥0.09~0.18/次",
  "nano-banana-pro-cl": "¥0.3~0.6/次", "nano-banana-pro-vip": "¥0.5~1/次",
  "nano-banana-pro-4k-vip": "¥0.8~1.6/次",
  "gpt-image-2": "¥0.03/张", "gpt-image-1": "¥0.02/张",
  "gpt-image-2-vip": "¥0.065/张",
  "dall-e-3": "¥0.04/张", "dall-e-2": "¥0.02/张",
  "gemini-2.5-flash-image": "¥0.022/张", "gemini-3.1-flash-image": "¥0.06/张",
  "gemini-3-pro-image-preview": "¥0.09/张",
  "flux-1.1-pro": "¥0.05/张", "flux-dev": "¥0.03/张", "flux-schnell": "¥0.01/张",
  "stable-diffusion-3.5-large": "¥0.04/张", "stable-diffusion-xl": "¥0.02/张",
  "midjourney-v7": "¥0.06/张", "midjourney-v6": "¥0.05/张",
  "imagen-3": "¥0.04/张",
  "gpt-4o": "¥17/M", "gpt-4o-mini": "¥1/M", "gpt-4-turbo": "¥70/M",
  "gpt-3.5-turbo": "¥3/M", "o3-mini": "¥8/M", "o1": "¥105/M",
  "claude-3-5-sonnet": "¥21/M", "claude-3-opus": "¥105/M", "claude-3-haiku": "¥1.7/M",
  "gemini-2.5-pro": "¥9/M", "gemini-2.5-flash": "¥1/M", "gemini-2.0-flash": "¥0.7/M",
  "deepseek-chat": "¥1/M", "deepseek-reasoner": "¥4/M",
  "qwen-max": "¥3/M", "qwen-plus": "¥1.5/M",
  "llama-3-70b": "¥5/M", "llama-3-8b": "¥0.5/M",
};

function priceLabel(modelId) {
  const p = KNOWN_PRICES[modelId];
  return p ? ` · ${p}` : "";
}

// ─── 内置模型列表（兜底用）─────────────────────────────────
function loadFallbackModels() {
  const ids = Object.keys(KNOWN_PRICES).filter(k => !/nano-banana|gpt-image-2-vip/.test(k));
  dom.modelList.innerHTML = "";
  ids.forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id + priceLabel(id);
    dom.modelList.appendChild(opt);
  });
  dom.model.value = "";
  dom.model.placeholder = `已加载 ${ids.length} 个模型，点击选择`;
  updateApiQuickState();
}

function loadGrsaiModels() {
  const ids = Object.keys(KNOWN_PRICES).filter(k => /gpt-image-2|nano-banana/.test(k));
  dom.modelList.innerHTML = "";
  ids.forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${id}  ·  ${KNOWN_PRICES[id]}`;
    dom.modelList.appendChild(opt);
  });
  dom.model.value = "";
  dom.model.placeholder = `已加载 ${ids.length} 个 GrsAI 模型，点击选择`;
  updateApiQuickState();
}

// 模型变更时提示价格 + 自动更新已保存配置
dom.model.addEventListener("change", () => {
  const m = dom.model.value.trim();
  if (KNOWN_PRICES[m]) showStatus(`已选: ${m} · ${KNOWN_PRICES[m]}`, "info");
  const idx = parseInt(dom.savedApis.value);
  if (!isNaN(idx)) {
    const apis = loadAllApis();
    if (apis[idx]) {
      apis[idx].model = m;
      saveAllApis(apis);
      renderSavedApis();
      dom.savedApis.value = idx;
    }
  }
  if (dom.apiEndpoint.value.trim() || dom.apiKey.value.trim()) {
    saveConfig(currentApiConfig());
  }
  updateApiQuickState();
});

// ─── 检测模型（适配器路由）─────────────────────────────────
dom.detectModels.addEventListener("click", detectModelsForAdapter);

dom.toggleKey.addEventListener("click", () => {
  const input = dom.apiKey;
  const isPw = input.type === "password";
  input.type = isPw ? "text" : "password";
  dom.toggleKey.innerHTML = icon(isPw ? "eye-off" : "eye");
});

// ─── 默认值 ────────────────────────────────────────────────
if (!config.endpoint) dom.apiEndpoint.placeholder = "https://grsai.dakka.com.cn";
if (!config.model)   dom.model.placeholder = "gpt-image-2";

// 端点变化时自动检测平台并加载对应模型
dom.apiEndpoint.addEventListener("change", () => {
  const ep = dom.apiEndpoint.value.trim();
  if (/grsai|dakka\.com\.cn|grsaiapi/.test(ep)) {
    loadGrsaiModels();
    dom.model.placeholder = "点击输入或检测选择模型";
  } else if (/jeniya\.top/.test(ep)) {
    dom.model.placeholder = "点击输入或检测选择模型";
  } else {
    dom.model.placeholder = "gpt-image-2";
  }
});

// ═══════════════════════════════════════════════════════════
//  模式切换
// ═══════════════════════════════════════════════════════════

dom.modeTabs.addEventListener("click", (e) => {
  const tab = e.target.closest(".mode-tab");
  if (!tab) return;
  const mode = tab.dataset.mode;
  if (mode === currentMode) return;
  switchMode(mode);
});

dom.sideRail?.addEventListener("click", (e) => {
  const item = e.target.closest(".rail-item");
  if (!item) return;

  const mode = item.dataset.railMode;
  if (mode) {
    switchMode(mode);
    return;
  }

  const action = item.dataset.railAction;
  if (action === "history") {
    dom.historyBtn?.click();
  } else if (action === "settings") {
    dom.settingsBtn?.click();
  } else if (action === "export") {
    void handleExportAction();
  }
});

// 头部导出按钮（侧栏移除后的导出入口，保留 data-rail-action 以兼容回归用例）
$("#exportBtn")?.addEventListener("click", () => void handleExportAction());

// GrsAI 推荐地址一键填入
$("#useGrsaiEndpoint")?.addEventListener("click", () => {
  if (dom.apiEndpoint) { dom.apiEndpoint.value = "https://grsai.dakka.com.cn"; dom.apiEndpoint.focus(); }
});

function getExportableHistoryCount() {
  return loadHistory().filter(item => {
    if (isHistoryProject(item)) return getHistoryImages(item).length > 0;
    return !!(item?.imageUrl || item?.url);
  }).length;
}

async function handleExportAction() {
  const images = getCurrentResultImages();
  if (images.length > 0) {
    dom.resultToolbar?.classList.remove("hidden");
    await downloadAllAsZip();
    return;
  }

  if (getExportableHistoryCount() > 0) {
    renderHistory();
    openModal(dom.historyModal);
    showStatus(cleanText("exportOpenedHistory"), "info");
    return;
  }

  showStatus(cleanText("noImagesToExport"), "error");
}

function updateRailMode(mode) {
  if (!dom.sideRail) return;
  $$("[data-rail-mode]", dom.sideRail).forEach(item => {
    item.classList.toggle("active", item.dataset.railMode === mode);
  });
}

function switchMode(mode) {
  currentMode = mode;
  if (abortController) stopCurrentGeneration();
  $$(".mode-tab", dom.modeTabs).forEach(t => {
    t.classList.toggle("active", t.dataset.mode === mode);
  });
  updateRailMode(mode);

  const isComic = mode === "comic";
  dom.comicSection.classList.toggle("hidden", !isComic);
  dom.nImagesField.classList.toggle("hidden", isComic);
  dom.progressWrap.classList.toggle("hidden", true);

  const label = $("#globalPromptField .field-label-text");
  if (label) label.textContent = tr(isComic ? "全局提示词（注入所有分镜）" : "提示词");

  setButtonText(dom.generateBtn, "spark", isComic ? "generateAll" : "generateImage");

  if (isComic) {
    dom.promptHint.textContent = tr("全局提示词将拼接在每个分镜提示词前面");
    if (dom.panelTbody.children.length === 0) addPanelRow();
  } else {
    dom.promptHint.textContent = "";
  }

  applyCleanLanguage();
  clearStatus();
}

function refreshLocalizedUiState() {
  const isComic = currentMode === "comic";
  const label = $("#globalPromptField .field-label-text");
  if (label) label.textContent = tr(isComic ? "全局提示词（注入所有分镜）" : "提示词");
  if (dom.promptHint) dom.promptHint.textContent = isComic ? tr("全局提示词将拼接在每个分镜提示词前面") : "";
  setButtonText(dom.generateBtn, "spark", isComic ? "generateAll" : "generateImage");
  setButtonText(dom.detectModels, "search", "detect");
  setButtonText(dom.downloadZip, "zip", "downloadZip");
}

// ═══════════════════════════════════════════════════════════
//  txt 文件导入
// ═══════════════════════════════════════════════════════════

dom.importTxt.addEventListener("click", e => {
  e.preventDefault();
  e.stopPropagation();
  openFileInputOnce(dom.txtFileInput);
});
dom.txtFileInput.addEventListener("change", () => {
  const files = [...dom.txtFileInput.files];
  if (files.length === 0) return;

  let loaded = 0;
  const newFiles = [];

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = () => {
      newFiles.push({ name: file.name, content: reader.result });
      loaded++;
      if (loaded === files.length) {
        newFiles.forEach(f => {
          if (!importedTxtFiles.find(x => x.name === f.name)) {
            importedTxtFiles.push(f);
          }
        });
        renderTxtBadges();
        showStatus(`已导入 ${files.length} 个文本参考 ✅`, "success");
      }
    };
    reader.readAsText(file, "UTF-8");
  });
  dom.txtFileInput.value = "";
});

function removeTxtFile(index) {
  importedTxtFiles.splice(index, 1);
  renderTxtBadges();
}

function renderTxtBadges() {
  dom.txtFileBadges.innerHTML = "";
  if (importedTxtFiles.length === 0) {
    dom.txtFileBadges.classList.add("hidden");
    return;
  }
  dom.txtFileBadges.classList.remove("hidden");
  importedTxtFiles.forEach((f, i) => {
    const badge = document.createElement("span");
    badge.className = "file-badge";
    badge.innerHTML = `
      <span class="file-badge-icon">${icon("file")}</span>
      <span class="file-badge-name">${escapeHtml(f.name)}</span>
      <button class="file-badge-clear" data-index="${i}">✕</button>`;
    badge.querySelector(".file-badge-clear").addEventListener("click", () => removeTxtFile(i));
    dom.txtFileBadges.appendChild(badge);
  });
}

function getEffectivePrompt() {
  const parts = [];
  if (importedTxtFiles.length > 0) {
    parts.push(importedTxtFiles.map(f => f.content).join("\n\n"));
  }
  if (dom.prompt.value.trim()) {
    parts.push(dom.prompt.value.trim());
  }
  return parts.join("\n\n");
}

function readImageReference(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("请选择有效的图片文件"));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取图片失败：${file.name || "未知文件"}`));
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onerror = () => reject(new Error(`图片解析失败：${file.name || "未知文件"}`));
      img.onload = () => resolve({
        file,
        fileName: file.name || "reference.png",
        dataUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function dedupeReferences(refs = []) {
  const seen = new Set();
  return refs.filter(ref => {
    if (!ref?.dataUrl || seen.has(ref.dataUrl)) return false;
    seen.add(ref.dataUrl);
    return true;
  });
}

function sortReferencesByName(refs = []) {
  return [...refs].sort((a, b) => {
    const nameA = a?.fileName || a?.file?.name || "";
    const nameB = b?.fileName || b?.file?.name || "";
    return nameA.localeCompare(nameB, "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function getPanelRequestReferences(panel) {
  return dedupeReferences([...(panel.references || []), ...referenceImages]);
}

// ═══════════════════════════════════════════════════════════
//  全局参考图片上传
// ═══════════════════════════════════════════════════════════

dom.uploadZone.addEventListener("click", e => {
  e.preventDefault();
  e.stopPropagation();
  openFileInputOnce(dom.refImage);
});
dom.uploadZone.addEventListener("dragover", e => { e.preventDefault(); dom.uploadZone.classList.add("drag-over"); });
dom.uploadZone.addEventListener("dragleave", () => dom.uploadZone.classList.remove("drag-over"));
dom.uploadZone.addEventListener("drop", e => {
  e.preventDefault();
  dom.uploadZone.classList.remove("drag-over");
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith("image/"));
  addReferenceImages(files);
});
dom.refImage.addEventListener("change", () => {
  const files = [...dom.refImage.files].filter(f => f.type.startsWith("image/"));
  addReferenceImages(files);
  dom.refImage.value = "";
});

async function addReferenceImages(files) {
  const imageFiles = [...files].filter(file => file.type?.startsWith("image/"));
  if (imageFiles.length === 0) return;

  try {
    const refs = await Promise.all(imageFiles.map(readImageReference));
    const before = referenceImages.length;
    referenceImages = sortReferencesByName(dedupeReferences([...referenceImages, ...refs]));
    const added = referenceImages.length - before;

    renderThumbGrid();
    if (added > 0) {
      showStatus(`已添加 ${added} 张参考图（共 ${referenceImages.length} 张）`, "success");
    } else {
      showStatus("这些参考图已经导入过了", "info");
    }
  } catch (err) {
    showStatus(err.message || "参考图导入失败", "error");
  }
}

function removeReferenceImage(index) {
  referenceImages.splice(index, 1);
  renderThumbGrid();
}

function renderThumbGrid() {
  dom.thumbGrid.innerHTML = "";
  if (referenceImages.length === 0) {
    dom.thumbGrid.classList.add("hidden");
    dom.uploadZone.classList.remove("hidden");
    return;
  }
  dom.thumbGrid.classList.remove("hidden");
  dom.uploadZone.classList.add("hidden");

  referenceImages.forEach((ref, i) => {
    const label = `参考图 ${i + 1}: ${ref.fileName || "未命名图片"}`;
    const item = document.createElement("div");
    item.className = "thumb-item";
    item.title = label;
    item.innerHTML = `
      <img src="${ref.dataUrl}" alt="${escapeHtml(label)}">
      <span class="thumb-index">${i + 1}</span>
      <button class="btn-clear" title="移除">✕</button>`;
    item.querySelector(".btn-clear").addEventListener("click", (e) => {
      e.stopPropagation();
      removeReferenceImage(i);
    });
    dom.thumbGrid.appendChild(item);
  });

  const addBtn = document.createElement("div");
  addBtn.className = "thumb-add";
  addBtn.textContent = "+";
  addBtn.title = "添加更多参考图";
  addBtn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    openFileInputOnce(dom.refImage);
  });
  dom.thumbGrid.appendChild(addBtn);
}

// ═══════════════════════════════════════════════════════════
//  分辨率
// ═══════════════════════════════════════════════════════════

dom.customWidth.addEventListener("focus", () => {
  const r = document.querySelector('input[name="size"][value="custom"]');
  if (r) r.checked = true;
});
dom.customHeight.addEventListener("focus", () => {
  const r = document.querySelector('input[name="size"][value="custom"]');
  if (r) r.checked = true;
});

function getSelectedSize() {
  const checked = document.querySelector('input[name="size"]:checked');
  if (!checked || checked.value !== "custom") return checked ? checked.value : "1024x1024";
  const w = parseInt(dom.customWidth.value) || 1024;
  const h = parseInt(dom.customHeight.value) || 1024;
  return `${w}x${h}`;
}

// ═══════════════════════════════════════════════════════════
//  分镜表格 CRUD
// ═══════════════════════════════════════════════════════════

const panelRowTemplate = $("#panelRowTemplate");

function syncPanelCountInput() {
  if (!dom.panelCount) return;
  const count = dom.panelTbody.children.length;
  dom.panelCount.value = String(Math.max(1, count));
}

function addPanelRow() {
  panelCounter++;
  const clone = panelRowTemplate.content.cloneNode(true);
  const row = clone.querySelector(".panel-row");

  row.querySelector(".panel-num").textContent = panelCounter;
  row.dataset.panelId = panelCounter;

  row.querySelector(".delete-panel").addEventListener("click", () => {
    row.remove();
    renumberPanels();
  });

  const imgInput = row.querySelector(".panel-img-input");
  const imgBtn = row.querySelector(".panel-img-btn");
  const imgPreview = row.querySelector(".panel-img-preview");
  const imgName = row.querySelector(".panel-img-name");
  const imgClear = row.querySelector(".panel-img-clear");

  imgBtn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    openFileInputOnce(imgInput);
  });
  imgInput.addEventListener("change", async () => {
    const file = imgInput.files[0];
    if (file && file.type.startsWith("image/")) {
      const readTask = readImageReference(file);
      row._panelReferenceTask = readTask;
      imgBtn.disabled = true;
      imgName.textContent = "读取中";
      try {
        const ref = await readTask;
        if (imgInput.files[0] !== file) return;
        row._panelReference = ref;
        imgPreview.style.backgroundImage = `url("${ref.dataUrl}")`;
        imgPreview.classList.remove("hidden");
        imgName.textContent = ref.fileName;
        imgName.title = ref.fileName;
        imgClear.classList.remove("hidden");
        showStatus(`分镜 ${row.dataset.panelId} 已绑定参考图`, "success");
      } catch (err) {
        row._panelReference = null;
        imgInput.value = "";
        imgName.textContent = "";
        imgName.title = "";
        imgPreview.style.backgroundImage = "";
        imgPreview.classList.add("hidden");
        imgClear.classList.add("hidden");
        showStatus(err.message || "分镜参考图读取失败", "error");
      } finally {
        if (row._panelReferenceTask === readTask) row._panelReferenceTask = null;
        imgBtn.disabled = false;
      }
    }
  });
  imgClear.addEventListener("click", () => {
    imgInput.value = "";
    row._panelReference = null;
    row._panelReferenceTask = null;
    imgPreview.style.backgroundImage = "";
    imgPreview.classList.add("hidden");
    imgName.textContent = "";
    imgName.title = "";
    imgClear.classList.add("hidden");
  });

  dom.panelTbody.appendChild(row);
  syncPanelCountInput();
  return row;
}

function renumberPanels() {
  $$(".panel-row", dom.panelTbody).forEach((row, i) => {
    row.querySelector(".panel-num").textContent = i + 1;
    row.dataset.panelId = i + 1;
  });
  panelCounter = dom.panelTbody.children.length;
  syncPanelCountInput();
}

function rowHasPanelContent(row) {
  return !!(
    row.querySelector("textarea")?.value.trim() ||
    row.querySelector(".panel-size-w")?.value ||
    row.querySelector(".panel-size-h")?.value ||
    row.querySelector(".panel-retry-count")?.value ||
    row._panelReference ||
    row.querySelector(".panel-img-input")?.files?.length
  );
}

function getPanelRetryCount(row) {
  const raw = row.querySelector(".panel-retry-count")?.value;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  return clampRetryCount(raw, getGlobalRetryCount());
}

function getRequestedPanelCount() {
  const raw = Number(dom.panelCount?.value);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(100, Math.max(1, Math.floor(raw)));
}

function setPanelCount(targetCount) {
  const target = Math.min(100, Math.max(1, Math.floor(Number(targetCount) || 1)));
  const rows = $$(".panel-row", dom.panelTbody);
  const current = rows.length;

  if (current === target) {
    showStatus(`当前已经是 ${target} 个分镜`, "info");
    syncPanelCountInput();
    return;
  }

  if (target > current) {
    for (let i = current; i < target; i++) addPanelRow();
    showStatus(`已创建 ${target} 个分镜`, "success");
    return;
  }

  const rowsToRemove = rows.slice(target);
  const hasContent = rowsToRemove.some(rowHasPanelContent);
  if (hasContent && !confirm(`将删除后面的 ${current - target} 个分镜及其内容，确定继续吗？`)) {
    syncPanelCountInput();
    return;
  }

  rowsToRemove.forEach(row => row.remove());
  renumberPanels();
  showStatus(`已调整为 ${target} 个分镜`, "success");
}

dom.createPanels?.addEventListener("click", () => {
  const target = getRequestedPanelCount();
  if (dom.panelCount) dom.panelCount.value = String(target);
  setPanelCount(target);
});
dom.panelCount?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    dom.createPanels?.click();
  }
});

dom.addPanel.addEventListener("click", addPanelRow);
dom.clearPanels.addEventListener("click", () => {
  if (dom.panelTbody.children.length === 0 && !abortController) return;
  if (confirm("确定清空所有分镜？")) {
    const wasGenerating = !!abortController;
    stopCurrentGeneration("已取消当前生成并清空分镜");
    dom.panelTbody.innerHTML = "";
    panelCounter = 0;
    syncPanelCountInput();
    if (wasGenerating) {
      dom.resultGrid.innerHTML = "";
      dom.resultGrid.classList.add("hidden");
      dom.emptyState.classList.remove("hidden");
      dom.resultToolbar.classList.add("hidden");
      generatedImageUrls = [];
      updateFailedRetryTools();
    }
  }
});

const AUTO_FILL_TEMPLATE_LABELS = {
  "panel-output": "输出分镜 N 的图片",
  "ref-bubble-number": "参考图 N 加编号气泡",
  "ref-caption-number": "参考图 N 加文字编号",
  custom: "自定义模板",
};

function renderAutoFillTemplate(template, vars) {
  return template
    .split("{n}").join(vars.n)
    .split("{ref}").join(vars.ref)
    .split("{caption}").join(vars.caption);
}

function getAutoFillPrompt(row, customTemplate = "") {
  const n = row.querySelector(".panel-num").textContent;
  const refIndex = n;
  const vars = { n, ref: refIndex, caption: n };
  const templateType = dom.autoFillTemplate?.value || "panel-output";

  if (templateType === "ref-bubble-number") {
    return renderAutoFillTemplate("给参考图{ref}加入{caption}的气泡字幕", vars);
  }
  if (templateType === "ref-caption-number") {
    return renderAutoFillTemplate("给参考图{ref}加入醒目的文字编号{caption}", vars);
  }
  if (templateType === "custom") {
    return renderAutoFillTemplate(customTemplate, vars);
  }
  return renderAutoFillTemplate("输出分镜{n}的图片", vars);
}

dom.autoFillPanels.addEventListener("click", () => {
  const templateType = dom.autoFillTemplate?.value || "panel-output";
  const shouldMatchReferenceCount = /^ref-/.test(templateType) && referenceImages.length > 0;

  if (shouldMatchReferenceCount && dom.panelTbody.children.length < referenceImages.length) {
    const rows = $$(".panel-row", dom.panelTbody);
    const hasContent = rows.some(rowHasPanelContent);
    if (!hasContent || confirm(`当前有 ${referenceImages.length} 张参考图，是否扩展为 ${referenceImages.length} 个分镜？`)) {
      setPanelCount(referenceImages.length);
    }
  } else if (dom.panelTbody.children.length === 0 && referenceImages.length > 0) {
    referenceImages.forEach(() => addPanelRow());
  }

  const rows = $$(".panel-row", dom.panelTbody);
  if (rows.length === 0) {
    showStatus("请先添加分镜", "info"); return;
  }

  const hasContent = rows.some(row => row.querySelector("textarea").value.trim());
  if (hasContent && !confirm("已有分镜提示词，确定用当前模板覆盖吗？")) return;

  let customTemplate = "";
  if (dom.autoFillTemplate?.value === "custom") {
    customTemplate = prompt("输入模板：可用 {n} 表示分镜编号，{ref} 表示参考图编号，{caption} 表示字幕内容", "给参考图{ref}加入{caption}的气泡字幕") || "";
    if (!customTemplate.trim()) return;
  }

  rows.forEach(row => {
    row.querySelector("textarea").value = getAutoFillPrompt(row, customTemplate.trim());
  });
  const label = AUTO_FILL_TEMPLATE_LABELS[dom.autoFillTemplate?.value || "panel-output"] || "当前模板";
  showStatus(`已按「${label}」填写 ${rows.length} 个分镜`, "success");
});

function collectPanels() {
  return $$(".panel-row", dom.panelTbody).map(row => ({
    id: row.dataset.panelId,
    prompt: row.querySelector("textarea").value.trim(),
    size: (() => {
      const w = row.querySelector(".panel-size-w")?.value;
      const h = row.querySelector(".panel-size-h")?.value;
      return (w && h) ? `${w}x${h}` : "";
    })(),
    imgFile: row.querySelector(".panel-img-input").files[0],
    references: row._panelReference ? [row._panelReference] : [],
    referenceTask: row._panelReferenceTask || null,
    retryCount: getPanelRetryCount(row),
  }));
}

async function waitForPanelReferenceTasks(panels) {
  const pending = panels.map(p => p.referenceTask).filter(Boolean);
  if (pending.length === 0) return;
  showStatus(`正在读取 ${pending.length} 张分镜参考图…`, "info");
  await Promise.allSettled(pending);
}

// ═══════════════════════════════════════════════════════════
//  状态提示 & 加载
// ═══════════════════════════════════════════════════════════

function showStatus(msg, type) {
  dom.status.textContent = translateTextValue(msg);
  dom.status.className = `status ${type}`;
}
function clearStatus() {
  dom.status.textContent = "";
  dom.status.className = "status hidden";
}
function showLoading(text = "正在生成中……") {
  dom.loadingText.textContent = tr(text);
  dom.loadingOverlay.classList.remove("hidden");
  dom.emptyState.classList.add("hidden");
  dom.resultGrid.classList.add("hidden");
}
function hideLoading() {
  dom.loadingOverlay.classList.add("hidden");
}

function resetGenerateButton() {
  dom.generateBtn.disabled = false;
  setButtonText(dom.generateBtn, "spark", currentMode === "comic" ? "generateAll" : "generateImage");
}

function beginGeneration() {
  activeGenerationId++;
  if (abortController) abortController.abort();
  abortController = new AbortController();
  dom.generateBtn.disabled = true;
  return {
    id: activeGenerationId,
    signal: abortController.signal,
  };
}

function isGenerationCurrent(run) {
  return !!run && run.id === activeGenerationId && !run.signal?.aborted;
}

function stopCurrentGeneration(message = "") {
  activeGenerationId++;
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  hideLoading();
  dom.progressWrap.classList.add("hidden");
  updateProgress(0, 0, "");
  resetGenerateButton();
  if (message) showStatus(message, "info");
}

// ═══════════════════════════════════════════════════════════
//  平台适配器注册表
// ═══════════════════════════════════════════════════════════

const adapters = [];

function registerAdapter(adapter) { adapters.push(adapter); }
function findAdapter(endpoint) {
  const url = endpoint.toLowerCase();
  for (const a of adapters) { if (a.detect(url)) return a; }
  return null;
}

function pixelSizeToRatio(size) {
  const exact = {
    "1024x1024": "1:1", "1536x1024": "3:2", "1024x1536": "2:3",
    "1792x1024": "16:9", "1024x1792": "9:16", "512x512": "1:1", "256x256": "1:1",
  };
  if (exact[size]) return exact[size];
  const [w, h] = size.split("x").map(Number);
  if (!w || !h) return "1:1";
  const ratio = w / h;
  const candidates = [
    { r: 1, label: "1:1" }, { r: 16/9, label: "16:9" }, { r: 9/16, label: "9:16" },
    { r: 4/3, label: "4:3" }, { r: 3/4, label: "3:4" },
    { r: 3/2, label: "3:2" }, { r: 2/3, label: "2:3" },
    { r: 5/4, label: "5:4" }, { r: 4/5, label: "4:5" },
    { r: 21/9, label: "21:9" },
  ];
  candidates.sort((a, b) => Math.abs(a.r - ratio) - Math.abs(b.r - ratio));
  return candidates[0].label;
}

// ═══════════════════════════════════════════════════════════
//  GrsAI 适配器
// ═══════════════════════════════════════════════════════════

registerAdapter({
  name: "GrsAI",
  detect(url) { return /grsai|dakka\.com\.cn|grsaiapi/.test(url); },
  sizeFormat: "pixel",
  supportsReference: true,
  concurrency: 10,

  fetchModels() {
    loadGrsaiModels();
  },

  async generate(endpoint, apiKey, model, prompt, size, n, hasRef, refs = [], options = {}) {
    const signal = options.signal;
    throwIfAborted(signal);
    const base = endpoint.replace(/\/+$/, "").replace(/\/v1\/.*$/, "").replace(/\/$/, "");
    const isNano = /nano-banana/i.test(model);

    const body = {
      model, prompt, replyType: "json",
      aspectRatio: isNano ? pixelSizeToRatio(size) : size,
    };
    if (isNano) {
      body.imageSize = parseInt(size.split("x")[0]) >= 2048 ? "4K" : parseInt(size.split("x")[0]) >= 1536 ? "2K" : "1K";
    }
    if (hasRef && refs.length > 0) {
      body.images = refs.map(r => r.dataUrl);
    }
    console.log(`GrsAI 请求: model=${model} size=${size} hasRef=${hasRef} refs=${refs.length}`);

    const t0 = Date.now();
    let res = await apiFetch(`${base}/v1/api/generate`, apiKey, body, { signal });
    let data = res;
    console.log(`GrsAI /api/generate 响应 (${Date.now() - t0}ms):`, data.status);

    if (data.status === "running") {
      const taskId = data.id;
      if (!taskId) throw new Error("GrsAI 未返回任务 ID");
      for (let i = 0; ; i++) {
        await sleep(2000, signal);
        const pollResp = await smartFetch(`${base}/v1/api/result?id=${taskId}`, {
          headers: { "Authorization": `Bearer ${apiKey}` },
          signal,
        });
        if (!pollResp.ok) throw new Error(`轮询失败 HTTP ${pollResp.status}`);
        res = await pollResp.json();
        data = res;
        if (data.progress != null) showStatus(`GrsAI 生成中… ${data.progress}%`, "info");
        if (data.status === "succeeded") { clearStatus(); console.log(`GrsAI 完成 (${Date.now() - t0}ms)`); break; }
        if (data.status === "failed" || data.status === "violation") {
          throw new Error(`GrsAI 生成失败: ${data.error || data.status}`);
        }
      }
    }

    if (data.status === "violation") {
      throw new Error("GrsAI 生成失败: 内容违规");
    }
    if (data.status === "succeeded") {
      const url = data.results?.[0]?.url;
      if (url) return { data: [{ url }] };
      throw new Error("GrsAI 返回成功但无图片 URL");
    }
    throw new Error(`GrsAI 生成失败: ${data.error || data.status || "未知"}`);
  },
});

// ═══════════════════════════════════════════════════════════
//  JeniyaTop 适配器（OpenAI 兼容协议）
// ═══════════════════════════════════════════════════════════

registerAdapter({
  name: "JeniyaTop",
  detect(url) { return /jeniya\.top/.test(url); },
  sizeFormat: "pixel",
  supportsReference: true,
  concurrency: 10,

  async fetchModels(endpoint, apiKey) {
    const baseUrl = endpoint.replace(/\/v1\/.*$/, "").replace(/\/$/, "");
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
      const resp = await smartFetch(baseUrl + "/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
        signal: ctrl.signal,
      });
      clearTimeout(t);

      if (!resp.ok) {
        loadFallbackModels();
        showStatus("模型列表获取失败，已加载常用模型", "info");
        return;
      }
      const data = await resp.json();
      let models = data.data || [];
      if (models.length === 0) { loadFallbackModels(); return; }
      const imgRe = /image|dall-e|diffusion|flux|banana|midjourney|imagen|sdxl|stable|nano/i;
      const imgModels = models.filter(m => imgRe.test(m.id));
      if (imgModels.length > 0) models = imgModels;

      dom.modelList.innerHTML = "";
      models.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.id + priceLabel(m.id);
        dom.modelList.appendChild(opt);
      });
      dom.model.value = "";
      dom.model.placeholder = `已加载 ${models.length} 个生图模型，点击选择`;
      showStatus(`已加载 ${models.length} 个生图模型`, "success");
    } catch {
      loadFallbackModels();
      showStatus("模型列表获取失败，已加载常用模型", "info");
    }
  },

  async generate(endpoint, apiKey, model, prompt, size, n, hasRef, refs = [], options = {}) {
    const signal = options.signal;
    throwIfAborted(signal);
    if (!hasRef || refs.length === 0) {
      const url = normalizeApiUrl(endpoint, "images/generations");
      console.log(`JeniyaTop → generations model=${model}`);
      return apiFetch(url, apiKey, { model, prompt, n, size, response_format: "b64_json" }, { signal });
    }

    // 有参考图 → images/edits (multipart/form-data)
    const url = normalizeApiUrl(endpoint, "images/edits");
    const fd = new FormData();
    fd.append("model", model); fd.append("prompt", prompt);
    fd.append("n", String(n)); fd.append("size", size);
    fd.append("response_format", "b64_json");
    for (const ref of refs) {
      fd.append("image", dataUrlToBlob(ref.dataUrl), ref.fileName || "reference.png");
    }
    console.log(`JeniyaTop → edits model=${model} refs=${refs.length}`);

    const resp = await smartFetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: fd,
      signal,
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`edits 端点不支持 (HTTP ${resp.status})。该模型可能不支持参考图编辑，请去掉参考图或换用其他模型。\n${t.slice(0, 300)}`);
    }
    return resp.json();
  },
});

// ═══════════════════════════════════════════════════════════
//  OpenAI 兼容适配器
// ═══════════════════════════════════════════════════════════

registerAdapter({
  name: "OpenAI 兼容",
  detect(url) { return true; },
  sizeFormat: "pixel",
  supportsReference: true,
  concurrency: 10,

  async fetchModels(endpoint, apiKey) {
    const baseUrl = endpoint.replace(/\/v1\/(images\/(generations|edits)|chat\/completions)\/?$/, "").replace(/\/$/, "");
    const candidates = [baseUrl + "/v1/models", baseUrl + "/models"];

    for (const modelsUrl of candidates) {
      try {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
        const resp = await smartFetch(modelsUrl, {
          headers: { "Authorization": `Bearer ${apiKey}` },
          signal: ctrl.signal,
        });
        clearTimeout(t);

        if (resp.status === 401 || resp.status === 403) {
          loadFallbackModels();
          showStatus("检测端点存在，但 API Key 无效或无权限。已加载常用模型供选择", "info");
          return;
        }
        if (!resp.ok) continue;

        const contentType = resp.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) continue;

        const data = await resp.json();
        let models = data.data || [];
        if (models.length === 0) continue;

        const imgRe = /image|dall-e|diffusion|flux|banana|midjourney|imagen|sdxl|stable|nano/i;
        const imgModels = models.filter(m => imgRe.test(m.id));
        if (imgModels.length > 0) models = imgModels;

        dom.modelList.innerHTML = "";
        models.forEach(m => {
          const opt = document.createElement("option");
          opt.value = m.id;
          opt.textContent = m.id + priceLabel(m.id);
          dom.modelList.appendChild(opt);
        });
        dom.model.value = "";
        dom.model.placeholder = `已加载 ${models.length} 个生图模型，点击选择`;
        showStatus(`已加载 ${models.length} 个生图模型`, "success");
        return;
      } catch { continue; }
    }

    loadFallbackModels();
    showStatus("该 API 不开放模型列表，已加载常用模型", "info");
  },

  async generate(endpoint, apiKey, model, prompt, size, n, hasRef, refs = [], options = {}) {
    const signal = options.signal;
    throwIfAborted(signal);
    if (!hasRef || refs.length === 0) {
      const url = normalizeApiUrl(endpoint, "images/generations");
      console.log(`OpenAI → generations model=${model}`);
      return apiFetch(url, apiKey, { model, prompt, n, size, response_format: "b64_json" }, { signal });
    }

    const url = normalizeApiUrl(endpoint, "images/edits");
    const fd = new FormData();
    fd.append("model", model); fd.append("prompt", prompt);
    fd.append("n", String(n)); fd.append("size", size);
    fd.append("response_format", "b64_json");
    for (const ref of refs) {
      fd.append("image", dataUrlToBlob(ref.dataUrl), ref.fileName || "reference.png");
    }
    console.log(`OpenAI → edits model=${model} refs=${refs.length}`);

    const resp = await smartFetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: fd,
      signal,
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`edits 端点不支持 (HTTP ${resp.status})。该模型可能不支持参考图编辑，请去掉参考图或换用其他模型。\n${t.slice(0, 300)}`);
    }
    return resp.json();
  },
});

// ═══════════════════════════════════════════════════════════
//  API 调用核心（适配器路由）
// ═══════════════════════════════════════════════════════════

async function callImageAPI(prompt, size, n = 1, contextLabel = "图片", options = {}) {
  const signal = options.signal || null;
  const maxRetries = clampRetryCount(options.maxRetries, getGlobalRetryCount());
  throwIfAborted(signal);
  const endpoint = dom.apiEndpoint.value.trim();
  const apiKey   = dom.apiKey.value.trim();
  const model    = dom.model.value.trim() || "gpt-image-2";
  const refs     = Array.isArray(options.references) ? dedupeReferences(options.references) : referenceImages;
  const hasRef   = refs.length > 0;
  const adapter  = findAdapter(endpoint);

  console.log(`callImageAPI: adapter=${adapter?.name || "无(直连)"} model=${model} hasRef=${hasRef} refs=${refs.length} size=${size}`);

  let finalSize = size;
  if (dom.useOrigSize.checked && hasRef) {
    const ref = refs[0];
    if (ref.width && ref.height) finalSize = `${ref.width}x${ref.height}`;
  }

  return retryTransient(async attempt => {
    throwIfAborted(signal);
    if (attempt > 1) {
      showStatus(`${contextLabel} 服务繁忙，正在自动重试第 ${attempt - 1} 次…`, "info");
    }
    if (!adapter) {
      const url = normalizeApiUrl(endpoint, "images/generations");
      if (hasRef) console.warn("⚠ 无适配器匹配 + 有参考图：参考图将被忽略，仅走 generations 端点");
      return apiFetch(url, apiKey, { model, prompt, n, size: finalSize, response_format: "b64_json" }, { signal });
    }
    return adapter.generate(endpoint, apiKey, model, prompt, finalSize, n, hasRef, refs, { signal });
  }, { signal, maxRetries });
}

function isTransientApiError(err) {
  const msg = String(err?.message || err || "");
  return /HTTP\s*400\b/i.test(msg);
}

async function retryTransient(fn, options = {}) {
  const maxRetries = clampRetryCount(options.maxRetries, 3);
  const baseDelay = options.baseDelay ?? 1500;
  const signal = options.signal || null;
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    throwIfAborted(signal);
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (err?.name === "AbortError") throw err;
      if (attempt > maxRetries || !isTransientApiError(err)) throw err;
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 600);
      console.warn(`临时错误，${delay}ms 后重试 ${attempt}/${maxRetries}:`, err);
      await sleep(delay, signal);
    }
  }
  throw lastErr;
}

async function detectModelsForAdapter() {
  const endpoint = dom.apiEndpoint.value.trim();
  const apiKey   = dom.apiKey.value.trim();
  if (!endpoint || !apiKey) {
    showStatus("请先填写 API 地址和 Key", "error");
    keepApiConfigVisible();
    return;
  }

  const adapter = findAdapter(endpoint);
  if (!adapter) {
    loadFallbackModels();
    showStatus("未知平台，已加载通用模型列表", "info");
    return;
  }

  dom.detectModels.disabled = true;
  setIconText(dom.detectModels, "spark", currentLanguage === "en" ? "Detecting" : currentLanguage === "ja" ? "検出中" : currentLanguage === "ko" ? "감지 중" : currentLanguage === "zh-Hant" ? "偵測中" : "检测中");

  try {
    if (adapter.fetchModels) {
      await adapter.fetchModels(endpoint, apiKey);
    } else {
      loadFallbackModels();
      showStatus("该平台不支持模型列表查询，已加载常用模型", "info");
    }
    dom.model.focus();
  } catch (err) {
    loadFallbackModels();
    showStatus(`模型检测失败，已加载常用模型：${err.message || err}`, "error");
  } finally {
    dom.detectModels.disabled = false;
    setButtonText(dom.detectModels, "search", "detect");
  }
}

function createAbortError() {
  try { return new DOMException("生成已取消", "AbortError"); }
  catch {
    const err = new Error("生成已取消");
    err.name = "AbortError";
    return err;
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(createAbortError());
    }, { once: true });
  });
}

// ─── 并发控制 ──────────────────────────────────────────────

async function concurrentLimitSettled(tasks, limit = 20, signal = null) {
  const results = [];
  const executing = [];
  for (const task of tasks) {
    if (signal?.aborted) break;
    const p = task()
      .then(r => ({ status: "fulfilled", value: r }))
      .catch(e => ({ status: "rejected", reason: e?.message || String(e) }));
    results.push(p);
    const tracker = p.then(r => { executing.splice(executing.indexOf(tracker), 1); return r; });
    executing.push(tracker);
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

async function concurrentLimit(tasks, limit = 20) {
  const results = [];
  const executing = [];
  for (const task of tasks) {
    const tracker = task()
      .then(r => { executing.splice(executing.indexOf(tracker), 1); return r; })
      .catch(e => { executing.splice(executing.indexOf(tracker), 1); throw e; });
    results.push(tracker);
    executing.push(tracker);
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "image/png";
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function normalizeApiUrl(inputUrl, path) {
  let url = inputUrl.trim().replace(/\/+$/, "");
  if (/\/v1\//.test(url)) {
    const base = url.replace(/\/v1\/(images\/(generations|edits)|chat\/completions|models)\/?$/, "");
    return base + "/v1/" + path;
  }
  if (!url.endsWith("/v1")) url += "/v1";
  return url + "/" + path;
}

function headersToObject(headers = {}) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return { ...headers };
}

async function formDataToProxyFields(formData, signal = null) {
  const fields = [];
  for (const [name, value] of formData.entries()) {
    throwIfAborted(signal);
    if (value instanceof Blob) {
      fields.push({
        name,
        type: "blob",
        filename: value.name || "upload.bin",
        mimeType: value.type || "application/octet-stream",
        base64: await blobToBase64(value),
      });
    } else {
      fields.push({ name, type: "text", value: String(value) });
    }
  }
  return fields;
}

async function createProxyPayload(url, method, headers, body, signal = null) {
  if (body instanceof FormData) {
    return {
      url,
      method,
      headers,
      bodyType: "formData",
      fields: await formDataToProxyFields(body, signal),
    };
  }
  return { url, method, headers, body: body || "" };
}

async function smartFetch(url, options = {}) {
  const signal = options.signal || null;
  throwIfAborted(signal);
  const method = options.method || "GET";
  const headers = headersToObject(options.headers || {});
  const body = options.body instanceof FormData
    ? options.body
    : (typeof options.body === "string" || options.body == null ? options.body : JSON.stringify(options.body));

  if (nativeDownload.available() && /^https?:\/\//i.test(url)) {
    const payload = await createProxyPayload(url, method, headers, body, signal);
    const result = await nativeDownload.nativeFetchPayload(payload);
    throwIfAborted(signal);
    return new Response(result.body || "", {
      status: result.status || 200,
      headers: result.headers || {},
    });
  }

  const proxy = dom.proxyEndpoint?.value.trim();
  if (proxy && /^https?:\/\//i.test(url)) {
    const payload = await createProxyPayload(url, method, headers, body, signal);
    throwIfAborted(signal);
    return fetch(proxy, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  }

  try {
    return await fetch(url, options);
  } catch (err) {
    if (nativeDownload.available() && /^https?:\/\//i.test(url)) {
      const payload = await createProxyPayload(url, method, headers, body, signal);
      const result = await nativeDownload.nativeFetchPayload(payload);
      throwIfAborted(signal);
      return new Response(result.body || "", {
        status: result.status || 200,
        headers: result.headers || {},
      });
    }
    throw err;
  }
}

async function apiFetch(url, apiKey, body, options = {}) {
  let response;
  try {
    response = await smartFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal || null,
    });
  } catch (err) {
    if (err.message === "Failed to fetch") {
      console.error("请求 URL:", url);
      throw new Error("网络请求失败。安卓端会自动尝试原生网络；电脑浏览器请在 API 配置里填写代理地址，或运行项目内 api-proxy.js 后使用 http://127.0.0.1:8787/proxy");
    }
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const ct = response.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await response.text();
    const titleMatch = text.match(/<title>([^<]*)<\/title>/i);
    const hint = titleMatch ? `（页面标题: ${titleMatch[1]}）` : "";
    throw new Error(`服务器返回了网页而非 API 数据${hint}。请检查 API 地址是否正确`);
  }

  return response.json();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════════════════
//  校验
// ═══════════════════════════════════════════════════════════

function validateCommon() {
  const endpoint = dom.apiEndpoint.value.trim();
  const apiKey   = dom.apiKey.value.trim();
  if (!endpoint) { showStatus("请先配置 API 地址", "error"); keepApiConfigVisible(); return false; }
  if (!apiKey)   { showStatus("请先配置 API Key", "error"); keepApiConfigVisible(); return false; }
  return true;
}

// ═══════════════════════════════════════════════════════════
//  单图模式生成
// ═══════════════════════════════════════════════════════════

async function generateSingle() {
  if (!validateCommon()) return;

  const prompt  = getEffectivePrompt();
  const size    = getSelectedSize();
  const n       = parseInt(dom.nImages.value) || 1;
  const references = dedupeReferences(referenceImages);
  const retryCount = getGlobalRetryCount();

  if (!prompt) { showStatus("请输入提示词或导入 txt 文件", "error"); dom.prompt.focus(); return; }

  const run = beginGeneration();
  clearStatus();
  setIconText(dom.generateBtn, "spark", currentLanguage === "en" ? "Generating..." : currentLanguage === "ja" ? "生成中..." : currentLanguage === "ko" ? "생성 중..." : "生成中……");

  try {
    dom.resultGrid.innerHTML = "";
    dom.resultGrid.classList.remove("hidden");
    dom.resultToolbar.classList.remove("hidden");
    dom.emptyState.classList.add("hidden");
    updateFailedRetryTools();
    let ok = 0, fail = 0;

    const tasks = Array.from({ length: n }, (_, i) => async () => {
      if (!isGenerationCurrent(run)) return;
      const placeholder = addResultPlaceholder(i + 1, prompt, {
        mode: "single",
        prompt,
        size,
        references,
        retryCount,
      });
      try {
        const data = await callImageAPI(prompt, size, 1, `图片 ${i + 1}`, { references, signal: run.signal, maxRetries: retryCount });
        if (!isGenerationCurrent(run)) return;
        replacePlaceholder(placeholder, i + 1, data, prompt, {
          retryContext: { mode: "single", prompt, size, references, retryCount },
        });
        ok++;
      } catch (err) {
        if (err?.name === "AbortError" || !isGenerationCurrent(run)) return;
        markPlaceholderFailed(placeholder, i + 1, err.message, { mode: "single", prompt, size, references, retryCount });
        fail++;
      }
    });

    if (dom.sequentialMode.checked) {
      for (const task of tasks) {
        if (!isGenerationCurrent(run)) break;
        await task();
      }
    } else {
      await concurrentLimitSettled(tasks, 20, run.signal);
    }

    if (!isGenerationCurrent(run)) return;
    if (ok === 0) throw new Error(`全部 ${n} 张生成失败`);
    if (fail > 0) showStatus(`${ok} 张成功，${fail} 张失败`, "error");
    else showStatus(`${ok} 张全部生成完成`, "success");

  } catch (err) {
    if (err?.name === "AbortError" || !isGenerationCurrent(run)) return;
    hideLoading();
    let msg = err.message;
    if (msg === "Failed to fetch") {
      msg = "网络请求失败。手机端会自动尝试原生网络；电脑端请运行 node api-proxy.js，并在 API 配置里填写 http://127.0.0.1:8787/proxy";
    }
    showStatus(`生成失败: ${msg}`, "error");
    dom.emptyState.classList.remove("hidden");
  } finally {
    if (isGenerationCurrent(run)) {
      abortController = null;
      resetGenerateButton();
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  漫画分镜批量生成
// ═══════════════════════════════════════════════════════════

async function generateComic() {
  if (!validateCommon()) return;

  const globalPrompt = getEffectivePrompt();
  const globalSize   = getSelectedSize();
  let panels         = collectPanels();
  await waitForPanelReferenceTasks(panels);
  panels             = collectPanels();

  const validPanels = panels.filter(p => p.prompt);
  if (validPanels.length === 0) {
    showStatus("请至少为一个分镜填写提示词", "error"); return;
  }

  const run = beginGeneration();
  clearStatus();
  dom.resultGrid.innerHTML = "";
  dom.resultGrid.classList.remove("hidden");
  dom.resultToolbar.classList.remove("hidden");
  dom.emptyState.classList.add("hidden");
  updateFailedRetryTools();
  hideLoading();
  generatedImageUrls = [];
  setIconText(dom.generateBtn, "spark", currentLanguage === "en" ? "Generating..." : currentLanguage === "ja" ? "生成中..." : currentLanguage === "ko" ? "생성 중..." : "生成中……");
  dom.progressWrap.classList.remove("hidden");

  const total = validPanels.length;
  let completed = 0;
  let failed = 0;
  const globalRetryCount = getGlobalRetryCount();
  const projectImages = [];

  updateProgress(0, total, "⏳");

  const panelTasks = validPanels.map(panel => {
    const fullPrompt = globalPrompt ? `${globalPrompt}\n\n${panel.prompt}` : panel.prompt;
    const size = panel.size || globalSize;
    const references = getPanelRequestReferences(panel);
    const retryCount = panel.retryCount ?? globalRetryCount;
    const placeholder = addResultPlaceholder(panel.id, fullPrompt, {
      mode: "comic",
      globalPrompt,
      panelPrompt: panel.prompt,
      prompt: fullPrompt,
      size,
      references,
      retryCount,
    });
    return { panel, fullPrompt, size, references, retryCount, placeholder, globalPrompt };
  });

  let done = 0;
  const tasks = panelTasks.map(({ panel, fullPrompt, size, references, retryCount, placeholder }) => async () => {
    if (!isGenerationCurrent(run)) return;
    try {
      const data = await callImageAPI(fullPrompt, size, 1, `分镜 ${panel.id}`, { references, signal: run.signal, maxRetries: retryCount });
      if (!isGenerationCurrent(run)) return;
      const record = replacePlaceholder(placeholder, panel.id, data, fullPrompt, {
        skipHistory: true,
        recordPrompt: panel.prompt,
        fullPrompt,
        size,
        retryContext: { references, size, mode: "comic", globalPrompt, panelPrompt: panel.prompt, prompt: fullPrompt, fullPrompt, retryCount },
      });
      if (record) projectImages.push({ ...record, prompt: panel.prompt, panelPrompt: panel.prompt, fullPrompt, retryCount });
      completed++;
    } catch (err) {
      if (err.name !== "AbortError" && isGenerationCurrent(run)) {
        markPlaceholderFailed(placeholder, panel.id, err.message, {
          references,
          size,
          mode: "comic",
          globalPrompt,
          panelPrompt: panel.prompt,
          prompt: fullPrompt,
          fullPrompt,
          retryCount,
        });
        failed++;
      }
    }
    if (!isGenerationCurrent(run)) return;
    done++;
    updateProgress(done, total, done >= total ? "✅" : "⏳");
  });

  try {
    if (dom.sequentialMode.checked) {
      for (const task of tasks) {
        if (!isGenerationCurrent(run)) break;
        await task();
      }
    } else {
      await concurrentLimitSettled(tasks, 20, run.signal);
    }

    if (!isGenerationCurrent(run)) return;
    updateProgress(completed + failed, total, "✅");

    if (completed > 0) {
      await saveGenerationProject({
        id: `project_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        type: "comic-project",
        mode: "comic",
        title: `漫画项目 ${new Date().toLocaleString("zh-CN")}`,
        createdAt: new Date().toISOString(),
        globalPrompt,
        model: dom.model.value.trim(),
        endpoint: dom.apiEndpoint.value.trim(),
        size: globalSize,
        retryCount: globalRetryCount,
        totalPanels: total,
        panels: panelTasks.map(({ panel, size, retryCount }) => ({
          panelId: String(panel.id),
          panelPrompt: panel.prompt,
          prompt: panel.prompt,
          size,
          retryCount,
          status: projectImages.some(img => String(img.panelId) === String(panel.id)) ? "success" : "failed",
        })),
        images: projectImages.sort((a, b) => Number(a.panelId) - Number(b.panelId)),
      });
    }

    if (failed > 0) {
      showStatus(`完成：${completed} 成功 / ${failed} 失败`, "error");
    } else if (completed > 0) {
      showStatus(`全部 ${completed} 个分镜生成完成！`, "success");
    }
  } catch (err) {
    if (err?.name !== "AbortError" && isGenerationCurrent(run)) {
      showStatus(`批量生成失败: ${err.message || err}`, "error");
    }
  } finally {
    if (isGenerationCurrent(run)) {
      abortController = null;
      resetGenerateButton();
      setTimeout(() => {
        if (activeGenerationId === run.id) dom.progressWrap.classList.add("hidden");
      }, 3000);
    }
  }
}

function updateProgress(done, total, icon) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  dom.progressFill.style.width = `${pct}%`;
  dom.progressText.textContent = `${icon} ${done}/${total}`;
}

// ─── 结果卡片 / 人工重试 ─────────────────────────────────────

function addResultPlaceholder(panelId, prompt, retryContext = {}) {
  const card = document.createElement("div");
  card.className = "result-item";
  card.dataset.panelId = panelId;
  card.dataset.status = "loading";
  setRetryContext(card, panelId, {
    prompt,
    size: getSelectedSize(),
    mode: currentMode,
    ...retryContext,
  });
  card.innerHTML = `
    <div class="panel-label">分镜 ${panelId}</div>
    <div class="result-media result-media-loading">
      <div class="spinner" style="width:28px;height:28px;"></div>
    </div>
    <div class="result-actions">
      <span style="font-size:0.75rem;color:var(--text2);padding:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" title="${escapeHtml(prompt)}">${escapeHtml(prompt.slice(0, 60))}…</span>
    </div>`;
  dom.resultGrid.appendChild(card);
  return card;
}

function makeCardActionBtn(iconName, key, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-sm card-action";
  btn.title = cleanText(key);
  btn.setAttribute("aria-label", cleanText(key));
  btn.innerHTML = icon(iconName);
  btn.addEventListener("click", onClick);
  return btn;
}

function replacePlaceholder(card, panelId, data, prompt, options = {}) {
  const item = (data.data || [])[0];
  let imageUrl = null;
  if (item) {
    if (item.url) imageUrl = item.url;
    else if (item.b64_json) imageUrl = `data:image/png;base64,${item.b64_json}`;
  }
  if (!imageUrl) {
    markPlaceholderFailed(card, panelId, "API 未返回图片数据", options.retryContext);
    return;
  }

  card.classList.remove("is-failed");
  delete card.dataset.failed;
  delete card.dataset.errorMessage;
  card.dataset.status = "success";
  card.style.borderColor = "";
  card.title = "";
  card.innerHTML = "";
  setRetryContext(card, panelId, {
    ...(card._retryContext || {}),
    ...(options.retryContext || {}),
    prompt,
    fullPrompt: options.fullPrompt || options.retryContext?.fullPrompt || options.retryContext?.prompt || prompt,
  });
  const label = document.createElement("div");
  label.className = "panel-label";
  label.textContent = `分镜 ${panelId}`;
  card.appendChild(label);

  const media = document.createElement("div");
  media.className = "result-media is-loading";
  const mediaStatus = document.createElement("div");
  mediaStatus.className = "result-media-status";
  const mediaStatusText = document.createElement("span");
  mediaStatusText.textContent = tr("图片加载中…");
  const reloadBtn = document.createElement("button");
  reloadBtn.type = "button";
  reloadBtn.className = "btn btn-sm result-media-reload";
  setButtonText(reloadBtn, "retry", "reloadImage");
  const img = document.createElement("img");
  let reloadAttempted = false;
  img.alt = `分镜 ${panelId}`;
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("load", () => {
    media.classList.remove("is-loading", "is-error");
    mediaStatusText.textContent = "";
    reloadBtn.disabled = false;
  });
  img.addEventListener("error", () => {
    media.classList.remove("is-loading");
    media.classList.add("is-error");
    reloadBtn.disabled = false;
    mediaStatusText.textContent = tr(reloadAttempted ? "重载失败，仍无法预览" : "图片链接暂时无法预览");
  });
  reloadBtn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    reloadAttempted = true;
    reloadBtn.disabled = true;
    media.classList.remove("is-error");
    media.classList.add("is-loading");
    mediaStatusText.textContent = tr("图片重新加载中…");
    const nextUrl = imageUrl.startsWith("data:")
      ? imageUrl
      : `${imageUrl}${imageUrl.includes("?") ? "&" : "?"}_reload=${Date.now()}`;
    img.removeAttribute("src");
    setTimeout(() => { img.src = nextUrl; }, 30);
  });
  img.addEventListener("click", () => {
    if (!media.classList.contains("is-error")) openLightbox(imageUrl);
  });
  mediaStatus.append(mediaStatusText, reloadBtn);
  media.append(img, mediaStatus);
  card.appendChild(media);
  img.src = imageUrl;
  const recordPrompt = options.recordPrompt
    ?? (options.retryContext?.mode === "comic" ? getPanelOnlyPrompt(options.retryContext, options.retryContext?.globalPrompt || "") : prompt);
  const fullPrompt = options.fullPrompt || options.retryContext?.fullPrompt || (recordPrompt !== prompt ? prompt : "");

  card._zipImage = {
    url: imageUrl,
    panelId: String(panelId),
    prompt: recordPrompt,
    panelPrompt: options.retryContext?.panelPrompt || (options.retryContext?.mode === "comic" ? recordPrompt : ""),
    fullPrompt,
  };

  const actions = document.createElement("div");
  actions.className = "result-actions";
  actions.append(
    makeCardActionBtn("download", "download", () => downloadImage(imageUrl, panelId)),
    makeCardActionBtn("copy", "copyLink", () => copyImageUrl(imageUrl, item.url)),
    makeCardActionBtn("retry", "retry", () => retryResultCard(card, false)),
    makeCardActionBtn("edit", "editRetry", () => retryResultCard(card, true))
  );
  card.appendChild(actions);

  const record = {
    id: `img_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    mode: options.mode || options.retryContext?.mode || currentMode,
    panelId: String(panelId),
    prompt: recordPrompt,
    panelPrompt: options.retryContext?.panelPrompt || (options.retryContext?.mode === "comic" ? recordPrompt : ""),
    fullPrompt,
    model: dom.model.value.trim(),
    endpoint: dom.apiEndpoint.value.trim(),
    size: options.size || options.retryContext?.size || getSelectedSize(),
    imageUrl,
    originalUrl: item.url || "",
    retryCount: options.retryContext?.retryCount ?? getGlobalRetryCount(),
  };
  generatedImageUrls.push({ url: imageUrl, panelId: String(panelId), prompt, recordId: record.id });
  if (!options.skipHistory) saveGenerationRecord(record);
  updateFailedRetryTools();
  return record;
}

function markPlaceholderFailed(card, panelId, errMsg, retryContext = {}) {
  const message = String(errMsg || "生成失败");
  setRetryContext(card, panelId, { ...(card._retryContext || {}), ...(retryContext || {}) });
  card.classList.add("is-failed");
  card.dataset.failed = "true";
  card.dataset.status = "failed";
  card.dataset.errorMessage = message;
  delete card._zipImage;
  card.innerHTML = `
    <div class="panel-label">分镜 ${panelId}</div>
    <div class="result-media result-media-failed">
      <div class="result-error">
        <strong><span class="ui-icon ui-icon-retry"></span> 失败</strong>
        <small>${escapeHtml(cleanText("failReason"))}</small>
        <span class="result-error-message">${escapeHtml(message.slice(0, 500))}</span>
      </div>
    </div>
    <div class="result-actions">
      <button type="button" class="btn btn-sm card-action retry-now" title="${escapeHtml(cleanText("retry"))}" aria-label="${escapeHtml(cleanText("retry"))}">${icon("retry")}</button>
      <button type="button" class="btn btn-sm card-action edit-retry" title="${escapeHtml(cleanText("editRetry"))}" aria-label="${escapeHtml(cleanText("editRetry"))}">${icon("edit")}</button>
    </div>`;
  card.style.borderColor = "var(--error)";
  card.title = message;
  card.querySelector(".retry-now")?.addEventListener("click", () => retryResultCard(card, false));
  card.querySelector(".edit-retry")?.addEventListener("click", () => retryResultCard(card, true));
  updateFailedRetryTools();
}

function getFailedResultCards() {
  if (!dom.resultGrid) return [];
  return Array.from(dom.resultGrid.querySelectorAll(".result-item.is-failed, .result-item[data-failed='true']"))
    .filter(card => card.isConnected);
}

function setRetryFailedButtonText(count = getFailedResultCards().length) {
  if (!dom.retryFailedAll) return;
  const suffix = count > 0 ? ` (${count})` : "";
  dom.retryFailedAll.innerHTML = `${icon("retry")} ${cleanText("retryFailedAll")}${suffix}`;
}

function updateFailedRetryTools() {
  const count = getFailedResultCards().length;
  dom.retryFailedTools?.classList.toggle("hidden", count === 0);
  if (dom.retryFailedAll) {
    dom.retryFailedAll.disabled = count === 0 || retryAllFailedInProgress;
    setRetryFailedButtonText(count);
  }
}

function getFailedRetryCount() {
  const retryCount = clampRetryCount(dom.failedRetryCount?.value, getGlobalRetryCount());
  if (dom.failedRetryCount) dom.failedRetryCount.value = String(retryCount);
  return retryCount;
}

async function retryAllFailedResults() {
  if (retryAllFailedInProgress) return;
  const cards = getFailedResultCards();
  if (!cards.length) {
    updateFailedRetryTools();
    showStatus(cleanText("noFailedToRetry"), "info");
    return;
  }

  const retryCount = getFailedRetryCount();
  retryAllFailedInProgress = true;
  updateFailedRetryTools();
  if (dom.retryFailedAll) dom.retryFailedAll.innerHTML = `${icon("spark")} ${cleanText("retry")} (${cards.length})`;

  let ok = 0;
  let failed = 0;
  try {
    for (const card of cards) {
      if (!card.isConnected || !card.classList.contains("is-failed")) continue;
      const success = await retryResultCard(card, false, { retryCountOverride: retryCount, quiet: true });
      if (success) ok++;
      else failed++;
    }
    showStatus(failed > 0 ? `重试完成：${ok} 成功 / ${failed} 失败` : `已重试成功 ${ok} 个失败分镜`, failed > 0 ? "error" : "success");
  } finally {
    retryAllFailedInProgress = false;
    updateFailedRetryTools();
  }
}

function setRetryContext(card, panelId, context = {}) {
  card._retryContext = {
    panelId: String(panelId),
    mode: currentMode,
    size: getSelectedSize(),
    prompt: "",
    globalPrompt: "",
    panelPrompt: "",
    references: null,
    ...context,
  };
}

function composeRetryPrompt(context) {
  if (context.mode === "comic") {
    return context.globalPrompt ? `${context.globalPrompt}\n\n${context.panelPrompt || ""}`.trim() : (context.panelPrompt || context.prompt || "");
  }
  return context.prompt || "";
}

function editRetryContext(context) {
  const next = { ...context };
  if (next.mode === "comic") {
    const panel = prompt("修改该分镜提示词（全局提示词会自动引用当前页面里的内容）", next.panelPrompt || next.prompt || "");
    if (panel === null) return null;
    next.globalPrompt = getEffectivePrompt();
    next.panelPrompt = panel.trim();
    next.prompt = composeRetryPrompt(next);
    return next;
  }
  const edited = prompt("修改提示词后重试", next.prompt || "");
  if (edited === null) return null;
  next.prompt = edited.trim();
  return next;
}

function renderRetryLoading(card, panelId, promptText) {
  card.classList.remove("is-failed");
  delete card.dataset.failed;
  delete card.dataset.errorMessage;
  delete card._zipImage;
  card.dataset.status = "loading";
  card.style.borderColor = "";
  card.title = "";
  card.innerHTML = `
    <div class="panel-label">分镜 ${escapeHtml(String(panelId))}</div>
    <div class="result-media result-media-loading">
      <div class="spinner" style="width:28px;height:28px;"></div>
      <div style="font-size:0.82rem;">正在重试生成…</div>
    </div>
    <div class="result-actions">
      <span style="font-size:0.75rem;color:var(--text2);padding:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" title="${escapeHtml(promptText)}">${escapeHtml(promptText.slice(0, 80))}</span>
    </div>`;
  updateFailedRetryTools();
}

async function retryResultCard(card, editBeforeRetry = false, options = {}) {
  const currentContext = card._retryContext || {};
  let context = { ...currentContext };
  if (editBeforeRetry) {
    context = editRetryContext(context);
    if (!context) return false;
  }
  const promptText = composeRetryPrompt(context);
  if (!promptText) {
    showStatus("重试前请先填写提示词", "error");
    return false;
  }
  const panelId = context.panelId || card.dataset.panelId || "重试";
  const size = context.size || getSelectedSize();
  const retryCount = clampRetryCount(options.retryCountOverride ?? context.retryCount, getGlobalRetryCount());
  setRetryContext(card, panelId, { ...context, prompt: promptText, size, retryCount });
  renderRetryLoading(card, panelId, promptText);
  try {
    const references = Array.isArray(context.references) ? context.references : undefined;
    const data = await callImageAPI(promptText, size, 1, `分镜 ${panelId}`, { references, maxRetries: retryCount });
    replacePlaceholder(card, panelId, data, promptText, {
      recordPrompt: context.mode === "comic" ? getPanelOnlyPrompt(context, context.globalPrompt || "") : promptText,
      fullPrompt: promptText,
      retryContext: { ...context, prompt: promptText, fullPrompt: promptText, size, retryCount },
    });
    if (!options.quiet) showStatus(`分镜 ${panelId} 重试成功`, "success");
    return true;
  } catch (err) {
    markPlaceholderFailed(card, panelId, err.message || String(err), { ...context, prompt: promptText, size, retryCount });
    if (!options.quiet) showStatus(`分镜 ${panelId} 重试失败: ${err.message || err}`, "error");
    return false;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function stripGlobalPromptFromText(text = "", globalPrompt = "") {
  const raw = String(text || "").trim();
  const global = String(globalPrompt || "").trim();
  if (!raw || !global) return raw;
  if (raw === global) return "";
  if (raw.startsWith(global)) {
    return raw.slice(global.length).replace(/^\s+/, "").trim();
  }
  return raw;
}

function getPanelOnlyPrompt(source = {}, globalPrompt = "") {
  const panelPrompt = String(source.panelPrompt || "").trim();
  if (panelPrompt) return panelPrompt;
  const prompt = String(source.prompt || "").trim();
  if (prompt) return stripGlobalPromptFromText(prompt, globalPrompt);
  return stripGlobalPromptFromText(source.fullPrompt || "", globalPrompt);
}

// ═══════════════════════════════════════════════════════════
//  生图历史记录（本地存储，电脑端 / 安卓端共用）
// ═══════════════════════════════════════════════════════════

const HISTORY_KEY = "ai_image_gen_history_v1";

function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function isHistoryProject(item) {
  return item?.type === "comic-project" || (Array.isArray(item?.images) && item.mode === "comic");
}

function getHistoryImages(item) {
  return Array.isArray(item?.images)
    ? item.images
      .filter(img => img?.imageUrl || img?.url)
      .map(img => ({ ...img, imageUrl: img.imageUrl || img.url }))
    : [];
}

function getHistoryThumbnail(item) {
  return isHistoryProject(item)
    ? (item.imageUrl || getHistoryImages(item)[0]?.imageUrl || "")
    : (item?.imageUrl || item?.url || "");
}

function compactHistoryItem(item) {
  if (!isHistoryProject(item)) return { ...item, imageUrl: item.originalUrl || item.imageUrl };
  const images = getHistoryImages(item).map(img => ({
    ...img,
    imageUrl: img.originalUrl || img.imageUrl,
  }));
  return {
    ...item,
    images,
    imageUrl: images[0]?.imageUrl || item.originalUrl || item.imageUrl,
  };
}

function saveHistory(list) {
  const limit = loadSettings().historyLimit || 100;
  const normalized = list
    .filter(x => x && getHistoryThumbnail(x))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(normalized));
  } catch (err) {
    const compact = normalized
      .map(compactHistoryItem)
      .slice(0, Math.max(20, Math.floor(limit / 2)));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(compact));
    console.warn("历史图片缓存超出 localStorage 限制，已裁剪旧记录并退回 URL 存储", err);
  }
}

async function saveGenerationRecord(record) {
  if (loadSettings().historyEnabled === false) return;
  record.imageUrl = await makeHistoryImageUrl(record.imageUrl);
  const list = loadHistory();
  list.unshift(record);
  saveHistory(list);
}

async function saveGenerationProject(project) {
  if (loadSettings().historyEnabled === false) return;
  const sourceImages = Array.isArray(project.images) ? project.images.filter(img => img?.imageUrl) : [];
  if (!sourceImages.length) return;

  const images = [];
  for (const img of sourceImages) {
    const panelPrompt = getPanelOnlyPrompt(img, project.globalPrompt || "");
    const { fullPrompt: _fullPrompt, ...imageRecord } = img;
    images.push({
      ...imageRecord,
      prompt: panelPrompt,
      panelPrompt,
      imageUrl: await makeHistoryImageUrl(img.imageUrl),
      originalUrl: img.originalUrl || img.imageUrl,
    });
  }

  const first = images[0];
  const record = {
    ...project,
    type: "comic-project",
    mode: "comic",
    prompt: project.globalPrompt || "",
    images,
    imageUrl: first?.imageUrl || "",
    originalUrl: first?.originalUrl || "",
  };
  const list = loadHistory();
  list.unshift(record);
  saveHistory(list);
}

async function makeHistoryImageUrl(imageUrl) {
  if (!imageUrl || imageUrl.startsWith("data:")) return imageUrl;
  try {
    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await blobToDataUrl(await resp.blob());
  } catch (err) {
    console.warn("历史图片本地缓存失败，保留远程 URL", err);
    return imageUrl;
  }
}

function formatDateGroup(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "未知日期";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function getFilteredHistory() {
  const q = (dom.historySearch?.value || "").trim().toLowerCase();
  const list = loadHistory();
  if (!q) return list;
  return list.filter(item => {
    const imageText = getHistoryImages(item)
      .flatMap(img => [img.prompt, img.panelPrompt, img.fullPrompt, img.panelId])
      .join(" ");
    const panelText = Array.isArray(item.panels)
      ? item.panels.flatMap(panel => [panel.prompt, panel.panelPrompt, panel.panelId]).join(" ")
      : "";
    return [
      item.title,
      item.prompt,
      item.globalPrompt,
      item.model,
      item.mode,
      item.type,
      item.size,
      item.createdAt,
      item.endpoint,
      imageText,
      panelText,
    ].some(v => String(v || "").toLowerCase().includes(q));
  });
}

function renderHistory() {
  if (!dom.historyList) return;
  const list = getFilteredHistory();
  dom.historyList.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = cleanText("noHistory");
    dom.historyList.appendChild(empty);
    return;
  }

  const groups = new Map();
  list.forEach(item => {
    const key = formatDateGroup(item.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  groups.forEach((items, dateLabel) => {
    const group = document.createElement("section");
    group.className = "history-date-group";
    const title = document.createElement("div");
    title.className = "history-date-title";
    title.textContent = `${dateLabel} · ${items.length}`;
    const grid = document.createElement("div");
    grid.className = "history-grid";

    items.forEach(item => grid.appendChild(createHistoryCard(item)));
    group.append(title, grid);
    dom.historyList.appendChild(group);
  });
}

function createHistoryProjectCard(item, images, thumbnail) {
  const card = document.createElement("article");
  card.className = "history-card history-card-project history-project-card";

  const strip = document.createElement("div");
  strip.className = "history-project-strip";
  const previewImages = images.slice(0, 3);
  if (previewImages.length === 0 && thumbnail) previewImages.push({ imageUrl: thumbnail, panelId: "1" });
  previewImages.forEach((image, index) => {
    const thumb = document.createElement("img");
    thumb.src = image.imageUrl || thumbnail;
    thumb.alt = `${cleanText("panelLabel")} ${image.panelId || index + 1}`;
    thumb.loading = "lazy";
    thumb.addEventListener("click", () => openLightbox(thumb.src));
    strip.appendChild(thumb);
  });
  if (images.length > previewImages.length) {
    const more = document.createElement("div");
    more.className = "history-project-more";
    more.textContent = `+${images.length - previewImages.length}`;
    strip.appendChild(more);
  }

  const meta = document.createElement("div");
  meta.className = "history-meta";
  const title = document.createElement("div");
  title.className = "history-project-title";
  title.textContent = item.title || `${cleanText("comicProject")} · ${images.length}`;
  const sub = document.createElement("div");
  sub.className = "history-sub";
  sub.textContent = `${formatTime(item.createdAt)} · ${cleanText("comicProject")} · ${images.length} · ${item.model || "-"}`;

  const details = document.createElement("details");
  details.className = "history-project-details";
  const summary = document.createElement("summary");
  summary.textContent = cleanText("viewPrompts");
  const promptList = document.createElement("div");
  promptList.className = "history-project-prompts";

  const addPromptBlock = (label, text) => {
    const block = document.createElement("div");
    block.className = "history-prompt-block";
    const strong = document.createElement("strong");
    strong.textContent = label;
    const body = document.createElement("span");
    body.textContent = text || cleanText("noPrompt");
    block.append(strong, body);
    promptList.appendChild(block);
  };

  if (item.globalPrompt) addPromptBlock(cleanText("globalPromptLabel"), item.globalPrompt);
  const panels = Array.isArray(item.panels) && item.panels.length ? item.panels : images;
  panels.forEach((panel, index) => {
    const panelId = panel.panelId || images[index]?.panelId || index + 1;
    const text = getPanelOnlyPrompt({
      panelPrompt: panel.panelPrompt || images[index]?.panelPrompt || "",
      prompt: panel.prompt || images[index]?.prompt || "",
      fullPrompt: panel.fullPrompt || images[index]?.fullPrompt || "",
    }, item.globalPrompt || "");
    addPromptBlock(`${cleanText("panelLabel")} ${panelId}`, text);
  });
  details.append(summary, promptList);
  meta.append(title, sub, details);

  const actions = document.createElement("div");
  actions.className = "history-actions";
  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "btn btn-xs";
  restore.textContent = cleanText("restoreProject");
  restore.addEventListener("click", () => restoreHistoryItem(item));
  const download = document.createElement("button");
  download.type = "button";
  download.className = "btn btn-xs";
  download.textContent = cleanText("downloadProject");
  download.addEventListener("click", () => downloadHistoryProject(item));
  actions.append(restore, download);

  card.append(strip, meta, actions);
  return card;
}

function createHistoryCard(item) {
  const project = isHistoryProject(item);
  const images = getHistoryImages(item);
  const thumbnail = getHistoryThumbnail(item);
  if (project) return createHistoryProjectCard(item, images, thumbnail);

  const card = document.createElement("article");
  card.className = "history-card";
  const img = document.createElement("img");
  img.src = thumbnail;
  img.alt = item.prompt || "历史图片";
  img.loading = "lazy";
  img.addEventListener("click", () => openLightbox(thumbnail));

  const meta = document.createElement("div");
  meta.className = "history-meta";
  const prompt = document.createElement("div");
  prompt.className = "history-prompt";
  const promptText = item.prompt || cleanText("noPrompt");
  prompt.textContent = promptText;
  prompt.title = item.prompt || "";
  const sub = document.createElement("div");
  sub.className = "history-sub";
  sub.textContent = `${formatTime(item.createdAt)} · ${item.model || "-"} · ${item.size || "-"}`;
  meta.append(prompt);
  const longPrompt = prompt.title || promptText;
  if (longPrompt.length > 120) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "history-prompt-toggle";
    toggle.textContent = "展开全部";
    toggle.addEventListener("click", () => {
      const expanded = prompt.classList.toggle("expanded");
      toggle.textContent = expanded ? "收起" : "展开全部";
    });
    meta.append(toggle);
  }
  meta.append(sub);

  const actions = document.createElement("div");
  actions.className = "history-actions";
  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "btn btn-xs";
  restore.textContent = ({ "zh-CN": "恢复", "zh-Hant": "恢復", en: "Restore", ja: "復元", ko: "복원" })[currentLanguage] || "恢复";
  restore.addEventListener("click", () => restoreHistoryItem(item));
  const download = document.createElement("button");
  download.type = "button";
  download.className = "btn btn-xs";
  download.textContent = cleanText("download");
  download.addEventListener("click", () => {
    downloadImage(item.imageUrl, item.panelId || item.id);
  });
  actions.append(restore, download);

  card.append(img, meta, actions);
  return card;
}

async function downloadHistoryProject(item) {
  const images = getHistoryImages(item);
  if (!images.length) {
    showStatus(cleanText("noImagesToExport"), "error");
    return;
  }
  setDownloadProgress(2, cleanText("preparingZip"));
  try {
    const zipBlob = await buildImagesZip(images.map((image, index) => ({
      ...image,
      url: image.imageUrl || image.url,
      panelId: image.panelId || index + 1,
    })), {
      folder: sanitizeFilePart(item.title || "comic-project", "comic-project"),
      mode: "comic",
      title: item.title || cleanText("comicProject"),
      createdAt: item.createdAt,
      model: item.model || "",
      globalPrompt: item.globalPrompt || "",
    });
    const filename = `${sanitizeFilePart(item.title || "comic-project", "comic-project")}.zip`;
    await saveOrDownloadBlob(zipBlob, filename, "application/zip", "zips");
    setDownloadProgress(100, `${cleanText("zipSaved")}: ${filename}`, true);
    showStatus(`${cleanText("zipSaved")}: ${filename}`, "success");
  } catch (err) {
    hideDownloadProgress();
    showStatus(`${cleanText("exportFailed")}: ${err.message || err}`, "error");
  }
}

function applyHistoryPanelSize(row, size) {
  const match = String(size || "").match(/^(\d{2,5})x(\d{2,5})$/);
  if (!match) return;
  const width = row.querySelector(".panel-size-w");
  const height = row.querySelector(".panel-size-h");
  if (width) width.value = match[1];
  if (height) height.value = match[2];
}

function restoreHistoryProjectEditor(item, images) {
  switchMode("comic");
  dom.prompt.value = item.globalPrompt || item.prompt || "";
  dom.panelTbody.innerHTML = "";
  panelCounter = 0;

  const sourcePanels = Array.isArray(item.panels) && item.panels.length ? item.panels : images;
  sourcePanels.forEach((panel, index) => {
    const matchingImage = images.find(img => String(img.panelId || "") === String(panel.panelId || index + 1)) || images[index] || {};
    const panelData = {
      ...matchingImage,
      ...panel,
      panelPrompt: panel.panelPrompt || matchingImage.panelPrompt || "",
      prompt: panel.prompt || matchingImage.prompt || "",
      fullPrompt: panel.fullPrompt || matchingImage.fullPrompt || "",
    };
    const row = addPanelRow();
    const promptInput = row.querySelector("textarea");
    if (promptInput) promptInput.value = getPanelOnlyPrompt(panelData, item.globalPrompt || "");
    applyHistoryPanelSize(row, panel.size || matchingImage.size || item.size || "");
    const retryInput = row.querySelector(".panel-retry-count");
    const retryValue = panel.retryCount ?? matchingImage.retryCount ?? item.retryCount;
    if (retryInput && retryValue !== undefined && retryValue !== null && retryValue !== "") {
      retryInput.value = String(clampRetryCount(retryValue, getGlobalRetryCount()));
    }
  });

  if (dom.panelTbody.children.length === 0) addPanelRow();
  syncPanelCountInput();
  refreshLocalizedUiState();
}

function restoreHistoryItem(item) {
  dom.resultGrid.classList.remove("hidden");
  dom.emptyState.classList.add("hidden");
  dom.resultToolbar.classList.remove("hidden");

  if (isHistoryProject(item)) {
    const images = getHistoryImages(item);
    restoreHistoryProjectEditor(item, images);
    dom.resultGrid.innerHTML = "";
    generatedImageUrls = [];
    updateFailedRetryTools();
    images.forEach((image, index) => {
      const card = document.createElement("div");
      card.className = "result-item";
      const panelId = image.panelId || index + 1;
      const data = { data: [{ url: image.imageUrl }] };
      const panelPrompt = getPanelOnlyPrompt(image, item.globalPrompt || "");
      const fullPrompt = image.fullPrompt || (item.globalPrompt ? `${item.globalPrompt}\n\n${panelPrompt}` : panelPrompt);
      replacePlaceholder(card, panelId, data, panelPrompt, {
        skipHistory: true,
        recordPrompt: panelPrompt,
        fullPrompt,
        size: image.size || item.size,
        retryContext: {
          mode: "comic",
          globalPrompt: item.globalPrompt || "",
          panelPrompt,
          prompt: fullPrompt,
          fullPrompt,
          size: image.size || item.size,
          retryCount: image.retryCount ?? item.retryCount ?? getGlobalRetryCount(),
        },
      });
      dom.resultGrid.appendChild(card);
    });
    updateFailedRetryTools();
    closeModal(dom.historyModal);
    showStatus(`已恢复漫画项目：${images.length} 张图片`, "success");
    return;
  }

  const card = document.createElement("div");
  card.className = "result-item";
  const data = { data: [{ url: item.imageUrl }] };
  replacePlaceholder(card, item.panelId || "历史", data, item.prompt || "", {
    skipHistory: true,
    size: item.size,
    retryContext: {
      mode: item.mode || currentMode,
      prompt: item.prompt || "",
      size: item.size,
      retryCount: item.retryCount ?? getGlobalRetryCount(),
    },
  });
  dom.resultGrid.prepend(card);
  updateFailedRetryTools();
  closeModal(dom.historyModal);
  showStatus("已从历史记录恢复到结果区", "success");
}

dom.historyBtn?.addEventListener("click", () => {
  renderHistory();
  openModal(dom.historyModal);
});
dom.closeHistory?.addEventListener("click", () => closeModal(dom.historyModal));
dom.historyModal?.addEventListener("click", e => { if (e.target === dom.historyModal) closeModal(dom.historyModal); });
dom.refreshHistory?.addEventListener("click", renderHistory);
dom.historySearch?.addEventListener("input", renderHistory);
dom.clearHistory?.addEventListener("click", () => {
  if (!confirm("确定清空全部生图记录？")) return;
  saveHistory([]);
  renderHistory();
  showStatus("历史记录已清空", "info");
});

// ═══════════════════════════════════════════════════════════
//  下载 & 复制
// ═══════════════════════════════════════════════════════════

const nativeDownload = (() => {
  let seq = 1;
  const pending = new Map();
  const dirs = { images: "", zips: "" };

  function available() {
    return typeof FlutterDownload !== "undefined" && FlutterDownload.postMessage;
  }

  function request(action, payload = {}) {
    if (!available()) return Promise.reject(new Error("native bridge unavailable"));
    const id = `req_${Date.now()}_${seq++}`;
    FlutterDownload.postMessage(JSON.stringify({ id, action, ...payload }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error("Android 保存通道超时"));
      }, 120000);
    });
  }

  window.AiGenAndroidBridge = {
    resolve(id, result) {
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      item.resolve(result);
    },
    reject(id, message) {
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      item.reject(new Error(message || "Android 操作失败"));
    },
    setDirs(nextDirs) {
      dirs.images = nextDirs?.images || "";
      dirs.zips = nextDirs?.zips || "";
      updateDirLabels();
    },
    onAppPaused() {
      appWasBackgrounded = true;
    },
    onAppResumed() {
      if (!appWasBackgrounded) return;
      appWasBackgrounded = false;
      updateDirLabels();
      if (!dom.historyModal?.classList.contains("hidden")) renderHistory();
      showStatus("已从后台返回，页面状态已刷新", "info");
    }
  };

  return {
    available,
    dirs,
    chooseDir(kind) { return request("chooseDir", { kind }); },
    nativeFetch(url, method, headers, body) {
      return request("nativeFetch", { url, method, headers, body });
    },
    nativeFetchPayload(payload) {
      return request("nativeFetch", payload);
    },
    nativeFetchBlob(url) {
      return request("nativeFetch", { url, method: "GET", responseType: "base64" });
    },
    saveFile(kind, fileName, mimeType, base64) {
      return request("saveFile", { kind, fileName, mimeType, base64 });
    },
  };
})();

document.body.classList.toggle("native-download", nativeDownload.available());
document.body.classList.toggle("no-native-download", !nativeDownload.available());

function shortPathLabel(uri) {
  if (!uri) return "未选择";
  try { return decodeURIComponent(uri).split("/").pop() || uri; }
  catch { return uri; }
}

function updateDirLabels() {
  if (dom.imageDirLabel) dom.imageDirLabel.textContent = shortPathLabel(nativeDownload.dirs.images);
  if (dom.zipDirLabel) dom.zipDirLabel.textContent = shortPathLabel(nativeDownload.dirs.zips);
  if (dom.settingsImageDirLabel) dom.settingsImageDirLabel.textContent = shortPathLabel(nativeDownload.dirs.images);
  if (dom.settingsZipDirLabel) dom.settingsZipDirLabel.textContent = shortPathLabel(nativeDownload.dirs.zips);
}

async function chooseDownloadDir(kind) {
  try {
    if (!nativeDownload.available()) {
      showStatus("当前不是 Flutter 安卓壳环境，浏览器会使用默认下载目录", "info");
      return;
    }
    await nativeDownload.chooseDir(kind);
    showStatus(kind === "images" ? "图片下载目录已更新" : "ZIP 下载目录已更新", "success");
  } catch (err) {
    showStatus(`目录选择失败: ${err.message}`, "error");
  }
}

dom.chooseImageDir?.addEventListener("click", () => chooseDownloadDir("images"));
dom.chooseZipDir?.addEventListener("click", () => chooseDownloadDir("zips"));
dom.settingsChooseImageDir?.addEventListener("click", () => chooseDownloadDir("images"));
dom.settingsChooseZipDir?.addEventListener("click", () => chooseDownloadDir("zips"));
updateDirLabels();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    appWasBackgrounded = true;
    return;
  }
  window.AiGenAndroidBridge?.onAppResumed?.();
});

function setDownloadProgress(percent, text, done = false) {
  if (!dom.downloadProgress || !dom.downloadProgressFill || !dom.downloadProgressText) return;
  dom.downloadProgress.classList.remove("hidden");
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  dom.downloadProgressFill.style.width = `${safe}%`;
  dom.downloadProgressText.textContent = text || `${safe}%`;
  dom.downloadProgress.classList.toggle("done", !!done);
  if (done) {
    setTimeout(() => dom.downloadProgress?.classList.add("hidden"), 3500);
  }
}

function hideDownloadProgress() {
  dom.downloadProgress?.classList.add("hidden");
  if (dom.downloadProgressFill) dom.downloadProgressFill.style.width = "0%";
  dom.downloadProgress?.classList.remove("done");
}

async function fetchBlobWithProgress(url, onProgress) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
  const total = Number(resp.headers.get("content-length")) || 0;
  if (!resp.body || !total) {
    const blob = await resp.blob();
    onProgress?.(100, blob.size, blob.size);
    return blob;
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(Math.round((received / total) * 100), received, total);
  }
  return new Blob(chunks, { type: resp.headers.get("content-type") || "application/octet-stream" });
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Blob 读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Blob 读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function blobToBytes(blob) {
  if (typeof blob?.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return base64ToBytes(await blobToBase64(blob));
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeUtf8(value) {
  const text = String(value ?? "");
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
  const encoded = unescape(encodeURIComponent(text));
  const bytes = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) bytes[i] = encoded.charCodeAt(i);
  return bytes;
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("Invalid data URL");
  const mime = match[1] || "application/octet-stream";
  const bytes = match[2] ? base64ToBytes(match[3]) : encodeUtf8(decodeURIComponent(match[3]));
  return new Blob([bytes], { type: mime });
}

async function imageUrlToBlob(url, onProgress) {
  if (String(url).startsWith("data:")) {
    const blob = dataUrlToBlob(url);
    onProgress?.(100, blob.size, blob.size);
    return blob;
  }
  if (nativeDownload.available() && /^https?:/i.test(url)) {
    const result = await nativeDownload.nativeFetchBlob(url);
    const status = Number(result?.status || 0);
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status || "?"}`);
    const headers = result?.headers || {};
    const type = headers["content-type"] || headers["Content-Type"] || "image/png";
    const blob = new Blob([base64ToBytes(result.base64 || "")], { type });
    onProgress?.(100, blob.size, blob.size);
    return blob;
  }
  return fetchBlobWithProgress(url, onProgress);
}

function sanitizeFilePart(value, fallback = "item") {
  const clean = String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return clean || fallback;
}

function imageExtFromBlob(url, blob) {
  const type = (blob?.type || "").toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (String(url).startsWith("data:image/jpeg")) return "jpg";
  if (String(url).startsWith("data:image/webp")) return "webp";
  if (String(url).startsWith("data:image/gif")) return "gif";
  return "png";
}

function getZipCrcTable() {
  if (getZipCrcTable.table) return getZipCrcTable.table;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  getZipCrcTable.table = table;
  return table;
}

function crc32(bytes) {
  const table = getZipCrcTable();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function makeZipBlob(entries) {
  const files = [];
  const central = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  entries.forEach(entry => {
    const nameBytes = encodeUtf8(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    files.push(local, data);

    const header = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, dosTime, true);
    view.setUint16(14, dosDate, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, data.length, true);
    view.setUint32(24, data.length, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint32(42, offset, true);
    header.set(nameBytes, 46);
    central.push(header);
    offset += local.length + data.length;
  });

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...files, ...central, end], { type: "application/zip" });
}

function promptsTextForExport(images, meta = {}) {
  const lines = [];
  lines.push(`${cleanText("appTitle")} Export`);
  lines.push(`Created: ${new Date().toLocaleString()}`);
  if (meta.title) lines.push(`Project: ${meta.title}`);
  if (meta.model) lines.push(`Model: ${meta.model}`);
  if (meta.globalPrompt) lines.push(`\n[${cleanText("globalPromptLabel")}]\n${meta.globalPrompt}`);
  images.forEach((image, index) => {
    lines.push(`\n[${cleanText("panelLabel")} ${image.panelId || index + 1}]`);
    lines.push(getPanelOnlyPrompt(image, meta.globalPrompt || "") || cleanText("noPrompt"));
  });
  return lines.join("\n");
}

async function buildImagesZip(images, meta = {}) {
  const entries = [];
  const exported = [];
  const failures = [];
  const folder = sanitizeFilePart(meta.folder || "images", "images");

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    try {
      setDownloadProgress(8 + Math.round((i / Math.max(images.length, 1)) * 52), `${cleanText("collectingImages")} ${i + 1}/${images.length}`);
      const blob = await imageUrlToBlob(image.url || image.imageUrl, pct => {
        const base = 8 + Math.round((i / Math.max(images.length, 1)) * 52);
        setDownloadProgress(Math.min(60, base + Math.round((pct || 0) * 0.2)), `${cleanText("collectingImages")} ${i + 1}/${images.length}`);
      });
      const bytes = await blobToBytes(blob);
      const panelId = sanitizeFilePart(image.panelId || i + 1, String(i + 1));
      const ext = imageExtFromBlob(image.url || image.imageUrl, blob);
      const filename = `${folder}/panel-${panelId}.${ext}`;
      entries.push({ name: filename, data: bytes });
      exported.push({ ...image, filename });
    } catch (err) {
      failures.push(`${image.panelId || i + 1}: ${err.message || err}`);
    }
  }

  entries.push({ name: `${folder}/prompts.txt`, data: encodeUtf8(promptsTextForExport(exported.length ? exported : images, meta)) });
  entries.push({
    name: `${folder}/project.json`,
    data: encodeUtf8(JSON.stringify({
      title: meta.title || "",
      mode: meta.mode || currentMode,
      createdAt: meta.createdAt || new Date().toISOString(),
      model: meta.model || dom.model?.value?.trim?.() || "",
      globalPrompt: meta.globalPrompt || "",
      images: exported.map(({ filename, panelId, prompt, panelPrompt, size, retryCount }) => {
        const promptOnly = getPanelOnlyPrompt({ prompt, panelPrompt }, meta.globalPrompt || "");
        return { filename, panelId, prompt: promptOnly, panelPrompt: promptOnly, size, retryCount };
      }),
      failures,
    }, null, 2)),
  });
  if (failures.length) entries.push({ name: `${folder}/download-errors.txt`, data: encodeUtf8(failures.join("\n")) });
  if (!exported.length && failures.length) throw new Error(failures.join("; "));

  setDownloadProgress(72, cleanText("compressing"));
  return makeZipBlob(entries);
}

async function downloadImage(imageUrl, index) {
  try {
    setDownloadProgress(3, "准备下载图片…");
    const filename = `panel-${index}.png`;
    const blob = await imageUrlToBlob(imageUrl, pct => {
      setDownloadProgress(Math.max(5, Math.min(85, pct * 0.85)), `图片下载中 ${pct}%`);
    });
    const knownBase64 = imageUrl.startsWith("data:") ? imageUrl.split(",")[1] : "";
    await saveOrDownloadBlob(blob, filename, blob.type || "image/png", "images", knownBase64);
    setDownloadProgress(100, `下载成功：panel-${index}.png`, true);
  } catch (err) {
    hideDownloadProgress();
    showStatus(`下载失败: ${err.message || err}`, "error");
    window.open(imageUrl, "_blank");
  }
}

async function saveOrDownloadBlob(blob, filename, mimeType, kind, knownBase64 = "") {
  if (nativeDownload.available()) {
    setDownloadProgress(88, "等待选择/写入目录…");
    if (!nativeDownload.dirs[kind]) {
      await nativeDownload.chooseDir(kind);
    }
    setDownloadProgress(94, "正在保存到本地…");
    const base64 = knownBase64 || await blobToBase64(blob);
    await nativeDownload.saveFile(kind, filename, mimeType, base64);
    showStatus(`已保存: ${filename}`, "success");
    return;
  }
  triggerDownload(blob, filename);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function copyImageUrl(dataUrl, originalUrl) {
  const text = originalUrl || dataUrl;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta);
  }
  showStatus("链接已复制", "success");
}

// ═══════════════════════════════════════════════════════════
//  ZIP 打包下载
// ═══════════════════════════════════════════════════════════

dom.downloadZip.addEventListener("click", downloadAllAsZip);

function getCurrentResultImages() {
  if (!dom.resultGrid) return [];
  return Array.from(dom.resultGrid.querySelectorAll(".result-item"))
    .map((card, index) => {
      if (card._zipImage?.url) return card._zipImage;
      const img = card.querySelector("img");
      if (!img?.src) return null;
      return {
        url: img.src,
        panelId: card._retryContext?.panelId || String(index + 1),
        prompt: card._retryContext?.mode === "comic"
          ? getPanelOnlyPrompt(card._retryContext, card._retryContext?.globalPrompt || "")
          : (card._retryContext?.prompt || img.alt || ""),
        panelPrompt: card._retryContext?.mode === "comic" ? getPanelOnlyPrompt(card._retryContext, card._retryContext?.globalPrompt || "") : "",
        fullPrompt: card._retryContext?.fullPrompt || card._retryContext?.prompt || "",
      };
    })
    .filter(Boolean);
}

dom.clearResults.addEventListener("click", () => {
  stopCurrentGeneration("已取消当前生成并清空结果");
  dom.resultGrid.innerHTML = "";
  dom.resultGrid.classList.add("hidden");
  dom.emptyState.classList.remove("hidden");
  dom.resultToolbar.classList.add("hidden");
  generatedImageUrls = [];
  updateFailedRetryTools();
});

async function downloadAllAsZip() {
  const images = getCurrentResultImages();
  if (images.length === 0) {
    showStatus(cleanText("noImagesToExport"), "error"); return;
  }

  dom.downloadZip.disabled = true;
  setButtonText(dom.downloadZip, "spark", "packaging");
  setDownloadProgress(2, cleanText("preparingZip"));

  try {
    const zipBlob = await buildImagesZip(images.map((image, index) => ({
      ...image,
      panelId: image.panelId || index + 1,
      prompt: image.prompt || "",
    })), {
      folder: currentMode === "comic" ? "comic-project" : "images",
      mode: currentMode,
      title: currentMode === "comic" ? cleanText("comicProject") : cleanText("appTitle"),
      globalPrompt: getEffectivePrompt(),
      model: dom.model.value.trim(),
    });
    const customName = dom.zipFileName.value.trim();
    const filename = customName ? `${sanitizeFilePart(customName, "images")}.zip` : `ai-images-${Date.now()}.zip`;
    await saveOrDownloadBlob(zipBlob, filename, "application/zip", "zips");

    setDownloadProgress(100, `${cleanText("zipSaved")}: ${filename}`, true);
    showStatus(`${cleanText("zipSaved")}: ${images.length}`, "success");
  } catch (err) {
    hideDownloadProgress();
    showStatus(`${cleanText("exportFailed")}: ${err.message || err}`, "error");
  } finally {
    dom.downloadZip.disabled = false;
    setButtonText(dom.downloadZip, "zip", "downloadZip");
  }
}

// ═══════════════════════════════════════════════════════════
//  灯箱
// ═══════════════════════════════════════════════════════════

function openLightbox(imageUrl) {
  const overlay = document.createElement("div");
  overlay.className = "lightbox";
  const img = document.createElement("img");
  img.src = imageUrl;
  overlay.appendChild(img);
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
  const onKey = e => { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
}

// ═══════════════════════════════════════════════════════════
//  生成按钮入口
// ═══════════════════════════════════════════════════════════

dom.generateBtn.addEventListener("click", () => {
  if (currentMode === "comic") generateComic();
  else generateSingle();
});

dom.prompt.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    dom.generateBtn.click();
  }
});

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register("sw.js").catch(err => {
    console.warn("Service worker registration skipped:", err);
  });
}

initI18n();
updateRailMode(currentMode);
registerServiceWorker();
