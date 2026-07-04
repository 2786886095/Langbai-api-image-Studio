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
const APP_VERSION = "1.3.5";
const RELEASE_API_URL = "https://api.github.com/repos/2786886095/Langbai-api-image-Studio/releases/latest";

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
  "浏览器 CORS 转发地址": { "zh-Hant": "瀏覽器 CORS 轉發位址", en: "Browser CORS proxy URL", ja: "ブラウザー CORS 転送 URL", ko: "브라우저 CORS 프록시 URL" },
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
    apiSettings: "API 配置", apiProvider: "API 类型", officialApi: "官方 API", grsaiImageApi: "GrsAI 生图 API", customApi: "自定义 API",
    savedApis: "已保存的 API", manualApi: "手动填写", setDefaultApi: "默认", defaultApi: "默认 API",
    apiProviderHint: "推荐生图中转网站：https://grsai.com/zh；请在浏览器打开管理，软件内不跳转网站。",
    apiUrl: "API 地址", grsaiEndpoint: "https://grsai.dakka.com.cn/v1/api/generate", grsaiWebsite: "推荐生图中转网站：https://grsai.com/zh", useGrsaiEndpoint: "填入 GrsAI 地址",
    model: "模型", detect: "检测", proxy: "浏览器 CORS 转发地址", saveConfig: "保存配置",
    modelChoicesPlaceholder: "从检测到的模型中选择…",
    desktopProxyTitle: "电脑端网络代理", desktopProxyMode: "代理模式", desktopProxyCustomUrl: "自定义代理地址",
    desktopProxyHttp: "HTTP 127.0.0.1:7890", desktopProxySocks: "SOCKS5 127.0.0.1:10808", desktopProxyDirect: "直连", desktopProxyCustom: "自定义",
    testDesktopProxy: "测试代理", desktopProxyHint: "默认使用 HTTP 127.0.0.1:7890；纯浏览器端请使用系统/浏览器代理或 api-proxy.js。",
    desktopProxyBrowserOnly: "浏览器端不能由网页切换 HTTP/SOCKS5 代理；请使用系统/浏览器代理或 api-proxy.js。",
    desktopProxyTesting: "正在测试代理…", desktopProxyOk: "代理测试成功：{mode} {target}", desktopProxyFailed: "代理测试失败：{reason}",
    desktopProxyInvalid: "自定义代理地址无效，仅支持 http://host:port、https://host:port、socks5://host:port",
    connectApi: "接入 API", apiDetect: "检测", apiConnected: "API 已接入", apiDisconnected: "API 未接入",
    apiConnectHint: "点击接入 API 后填写地址、Key 和模型",
    singleMode: "单图模式", comicMode: "漫画分镜", captionMode: "嵌字模式", prompt: "提示词", globalPrompt: "全局提示词",
    globalPromptComic: "全局提示词（注入所有分镜）", globalPromptCaption: "全局提示词（注入所有图片）", importTxt: "导入 txt",
    promptPlaceholder: "描述你想生成的图片，越详细越好……\n\n例如：一只橘猫坐在窗台上，阳光透过纱帘洒在它身上，油画风格，暖色调",
    globalRefs: "全局参考图片（可选，支持多选）", uploadRefs: "点击或拖拽上传参考图（可多选）",
    uploadRefsClickOnly: "点击上传参考图（可多选）",
    captionUploadHint: "点击或拖拽批量上传图片（自动按文件名顺序逐张生成，不会一次性打包发送）",
    captionUploadHintClickOnly: "点击批量上传图片（自动按文件名顺序逐张生成，不会一次性打包发送）",
    generateAllCaptions: "批量生成全部图片",
    matchSize: "输出尺寸与参考图一致", resolution: "全局分辨率", landscape: "横版 3:2", portrait: "竖版 2:3",
    custom: "自定义", width: "宽", height: "高", savedSizes: "常用尺寸", saveSizePreset: "保存尺寸", deleteSizePreset: "删除常用尺寸", imageCount: "生成数量", sequential: "依次生成",
    sequentialHint: "不勾选：并发批量生成（最多同时 20 个请求）；勾选：逐张依次生成",
    panelList: "分镜列表", captionList: "嵌字列表", addPanel: "添加分镜", clear: "清空", batchCreate: "批量创建", panelCount: "分镜数",
    createBtn: "创建", autoFill: "一键填写", fill: "填入", panelPrompt: "分镜提示词", retry: "重试",
    reference: "参考图", generateImage: "生成图片", generateAll: "批量生成全部分镜",
    imageFolder: "图片目录", zipFolder: "ZIP 目录", notSelected: "未选择", zipName: "压缩包名称（可选）…",
    downloadZip: "打包下载 ZIP", saveToFolder: "保存到文件夹", savingToFolder: "保存中……", folderSaved: "已保存到文件夹", clearResults: "清空结果", emptyTitle: "生成的图片将显示在这里",
    emptyHint: "在左侧输入提示词，点击「生成图片」开始", downloadPaths: "下载路径",
    imageSaveFolder: "图片保存目录", zipSaveFolder: "压缩包保存目录", chooseFolder: "选择目录",
    historyTitle: "生图记录", historyHint: "漫画会按项目保存，默认折叠提示词，数据保存在本机 localStorage。",
    searchHistory: "搜索提示词 / 模型 / 日期", refresh: "刷新", autoSaveHistory: "自动保存成功生成的图片记录",
    maxRecords: "最多保留记录数", clearAllHistory: "清空全部记录", autoRetry: "自动重试", globalRetries: "全局重试次数",
    retryHint: "只有 HTTP 400 会自动重试；0 表示不自动重试。分镜里的重试次数可覆盖这里。",
    restoreProject: "恢复项目", downloadProject: "导出项目", viewPrompts: "查看提示词与分镜",
    globalPromptLabel: "全局提示词", panelLabel: "分镜", noPrompt: "无提示词", comicProject: "漫画项目", captionProject: "嵌字项目",
    noHistory: "暂无生图记录", expand: "展开全部", collapse: "收起",
    noImagesToExport: "没有可导出的图片", exportOpenedHistory: "当前结果为空，已打开历史记录，可在项目卡片点击「导出项目」", packaging: "打包中……", preparingZip: "准备打包 ZIP…",
    collectingImages: "收集图片", compressing: "生成 ZIP", zipSaved: "ZIP 已保存", exportFailed: "导出失败",
    download: "下载", copyLink: "复制链接", editRetry: "编辑重试", reloadImage: "重新加载图片",
    failReason: "失败原因", retryFailedAll: "全部失败重试", failedRetryCount: "失败重试次数", noFailedToRetry: "没有可重试的失败分镜",
    softwareUpdate: "软件更新", currentVersion: "当前版本", latestVersion: "最新版本", updateAsset: "更新资源", notChecked: "未检测", releaseNotesPlaceholder: "检查更新后显示 GitHub Release 说明",
    checkUpdates: "检查更新", downloadUpdate: "下载更新包", installUpdate: "下载并安装",
    updateInitialHint: "可从 GitHub Releases 检测新版。Windows 会在下载后退出并覆盖安装目录；安卓会打开系统安装器。",
    checkingUpdates: "正在检查更新…", noUpdate: "已是最新版", updateAvailable: "发现新版本 {version}",
    updateCheckFailed: "检查更新失败", noUpdateAsset: "没有找到适合当前平台的更新包",
    downloadingUpdate: "正在下载更新包…", updateDownloaded: "更新包已下载: {path}",
    updateInstallStarted: "更新安装已启动。Windows 会关闭当前程序后覆盖安装目录；安卓请在系统安装器中确认。",
    updateOpenRelease: "当前环境不能直接覆盖安装，已打开更新包下载链接。",
    updateOpenGithubMobile: "安卓版请在 GitHub 发布页下载安装包，已为你打开该页面。",
    updateNowPrompt: "是否立即更新？"
  },
  "zh-Hant": {
    langZh: "簡體", langHant: "繁體", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI 圖片生成器", subtitle: "單圖生成 · 漫畫分鏡批次生成",
    web: "Web/PWA", desktop: "桌面", android: "安卓",
    create: "創作", panels: "分鏡", history: "歷史", export: "匯出", settings: "設定",
    apiSettings: "API 設定", apiProvider: "API 類型", officialApi: "官方 API", grsaiImageApi: "GrsAI 生圖 API", customApi: "自訂 API",
    savedApis: "已儲存的 API", manualApi: "手動填寫", setDefaultApi: "預設", defaultApi: "預設 API",
    apiProviderHint: "推薦生圖中轉網站：https://grsai.com/zh；請在瀏覽器開啟管理，軟體內不跳轉網站。",
    apiUrl: "API 位址", grsaiEndpoint: "https://grsai.dakka.com.cn/v1/api/generate", grsaiWebsite: "推薦生圖中轉網站：https://grsai.com/zh", useGrsaiEndpoint: "填入 GrsAI 位址",
    model: "模型", detect: "偵測", proxy: "瀏覽器 CORS 轉發位址", saveConfig: "儲存設定",
    modelChoicesPlaceholder: "從偵測到的模型中選擇…",
    desktopProxyTitle: "桌面端網路代理", desktopProxyMode: "代理模式", desktopProxyCustomUrl: "自訂代理位址",
    desktopProxyHttp: "HTTP 127.0.0.1:7890", desktopProxySocks: "SOCKS5 127.0.0.1:10808", desktopProxyDirect: "直連", desktopProxyCustom: "自訂",
    testDesktopProxy: "測試代理", desktopProxyHint: "預設使用 HTTP 127.0.0.1:7890；純瀏覽器端請使用系統/瀏覽器代理或 api-proxy.js。",
    desktopProxyBrowserOnly: "瀏覽器端不能由網頁切換 HTTP/SOCKS5 代理；請使用系統/瀏覽器代理或 api-proxy.js。",
    desktopProxyTesting: "正在測試代理…", desktopProxyOk: "代理測試成功：{mode} {target}", desktopProxyFailed: "代理測試失敗：{reason}",
    desktopProxyInvalid: "自訂代理位址無效，僅支援 http://host:port、https://host:port、socks5://host:port",
    connectApi: "接入 API", apiDetect: "偵測", apiConnected: "API 已接入", apiDisconnected: "API 未接入",
    apiConnectHint: "點擊接入 API 後填寫位址、Key 和模型",
    singleMode: "單圖模式", comicMode: "漫畫分鏡", captionMode: "嵌字模式", prompt: "提示詞", globalPrompt: "全域提示詞",
    globalPromptComic: "全域提示詞（套用到所有分鏡）", globalPromptCaption: "全域提示詞（套用到所有圖片）", importTxt: "匯入 txt",
    promptPlaceholder: "描述你想生成的圖片，越詳細越好……\n\n例如：一隻橘貓坐在窗台上，陽光透過紗簾灑在牠身上，油畫風格，暖色調",
    globalRefs: "全域參考圖片（可選，支援多選）", uploadRefs: "點擊或拖曳上傳參考圖（可多選）",
    uploadRefsClickOnly: "點擊上傳參考圖（可多選）",
    captionUploadHint: "點擊或拖曳批次上傳圖片（自動依檔名順序逐張生成，不會一次性打包傳送）",
    captionUploadHintClickOnly: "點擊批次上傳圖片（自動依檔名順序逐張生成，不會一次性打包傳送）",
    generateAllCaptions: "批次生成全部圖片",
    matchSize: "輸出尺寸與參考圖一致", resolution: "全域解析度", landscape: "橫版 3:2", portrait: "直版 2:3",
    custom: "自訂", width: "寬", height: "高", savedSizes: "常用尺寸", saveSizePreset: "儲存尺寸", deleteSizePreset: "刪除常用尺寸", imageCount: "生成數量", sequential: "依序生成",
    sequentialHint: "不勾選：並發批次生成（最多同時 20 個請求）；勾選：逐張依序生成",
    panelList: "分鏡列表", captionList: "嵌字列表", addPanel: "新增分鏡", clear: "清空", batchCreate: "批次建立", panelCount: "分鏡數",
    createBtn: "建立", autoFill: "一鍵填寫", fill: "填入", panelPrompt: "分鏡提示詞", retry: "重試",
    reference: "參考圖", generateImage: "生成圖片", generateAll: "批次生成全部分鏡",
    imageFolder: "圖片目錄", zipFolder: "ZIP 目錄", notSelected: "未選擇", zipName: "壓縮包名稱（可選）…",
    downloadZip: "打包下載 ZIP", saveToFolder: "儲存到資料夾", savingToFolder: "儲存中……", folderSaved: "已儲存到資料夾", clearResults: "清空結果", emptyTitle: "生成的圖片將顯示在這裡",
    emptyHint: "在左側輸入提示詞，點擊「生成圖片」開始", downloadPaths: "下載路徑",
    imageSaveFolder: "圖片儲存目錄", zipSaveFolder: "壓縮包儲存目錄", chooseFolder: "選擇目錄",
    historyTitle: "生圖記錄", historyHint: "漫畫會按專案保存，預設摺疊提示詞，資料保存在本機 localStorage。",
    searchHistory: "搜尋提示詞 / 模型 / 日期", refresh: "重新整理", autoSaveHistory: "自動保存成功生成的圖片記錄",
    maxRecords: "最多保留記錄數", clearAllHistory: "清空全部記錄", autoRetry: "自動重試", globalRetries: "全域重試次數",
    retryHint: "只有 HTTP 400 會自動重試；0 表示不自動重試。分鏡中的重試次數可覆蓋這裡。",
    restoreProject: "恢復專案", downloadProject: "匯出專案", viewPrompts: "查看提示詞與分鏡",
    globalPromptLabel: "全域提示詞", panelLabel: "分鏡", noPrompt: "無提示詞", comicProject: "漫畫專案", captionProject: "嵌字專案",
    noHistory: "暫無生圖記錄", expand: "展開全部", collapse: "收起",
    noImagesToExport: "沒有可匯出的圖片", exportOpenedHistory: "目前結果為空，已開啟歷史記錄，可在專案卡片點擊「匯出專案」", packaging: "打包中……", preparingZip: "準備打包 ZIP…",
    collectingImages: "收集圖片", compressing: "生成 ZIP", zipSaved: "ZIP 已保存", exportFailed: "匯出失敗",
    download: "下載", copyLink: "複製連結", editRetry: "編輯重試", reloadImage: "重新載入圖片",
    failReason: "失敗原因", retryFailedAll: "全部失敗重試", failedRetryCount: "失敗重試次數", noFailedToRetry: "沒有可重試的失敗分鏡",
    softwareUpdate: "軟體更新", currentVersion: "目前版本", latestVersion: "最新版本", updateAsset: "更新資源", notChecked: "未檢測", releaseNotesPlaceholder: "檢查更新後顯示 GitHub Release 說明",
    checkUpdates: "檢查更新", downloadUpdate: "下載更新包", installUpdate: "下載並安裝",
    updateInitialHint: "可從 GitHub Releases 檢測新版。Windows 會在下載後退出並覆蓋安裝目錄；Android 會開啟系統安裝器。",
    checkingUpdates: "正在檢查更新…", noUpdate: "已是最新版本", updateAvailable: "發現新版本 {version}",
    updateCheckFailed: "檢查更新失敗", noUpdateAsset: "沒有找到適合目前平台的更新包",
    downloadingUpdate: "正在下載更新包…", updateDownloaded: "更新包已下載: {path}",
    updateInstallStarted: "更新安裝已啟動。Windows 會關閉目前程式後覆蓋安裝目錄；Android 請在系統安裝器中確認。",
    updateOpenRelease: "目前環境不能直接覆蓋安裝，已開啟更新包下載連結。",
    updateOpenGithubMobile: "Android 版請在 GitHub 發布頁下載安裝包，已為你開啟該頁面。",
    updateNowPrompt: "是否立即更新？"
  },
  en: {
    langZh: "简体", langHant: "繁體", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI Image Generator", subtitle: "Single images · Batch comic storyboards",
    web: "Web/PWA", desktop: "Desktop", android: "Android",
    create: "Create", panels: "Panels", history: "History", export: "Export", settings: "Settings",
    apiSettings: "API Settings", apiProvider: "API Type", officialApi: "Official API", grsaiImageApi: "GrsAI Image API", customApi: "Custom API",
    savedApis: "Saved APIs", manualApi: "Manual entry", setDefaultApi: "Default", defaultApi: "Default API",
    apiProviderHint: "Recommended image gateway: https://grsai.com/zh. Manage it in your browser; the app will not open the website.",
    apiUrl: "API URL", grsaiEndpoint: "https://grsai.dakka.com.cn/v1/api/generate", grsaiWebsite: "Recommended image gateway: https://grsai.com/zh", useGrsaiEndpoint: "Use GrsAI URL",
    model: "Model", detect: "Detect", proxy: "Browser CORS proxy URL", saveConfig: "Save config",
    modelChoicesPlaceholder: "Choose from detected models...",
    desktopProxyTitle: "Desktop Network Proxy", desktopProxyMode: "Proxy mode", desktopProxyCustomUrl: "Custom proxy URL",
    desktopProxyHttp: "HTTP 127.0.0.1:7890", desktopProxySocks: "SOCKS5 127.0.0.1:10808", desktopProxyDirect: "Direct", desktopProxyCustom: "Custom",
    testDesktopProxy: "Test proxy", desktopProxyHint: "Default: HTTP 127.0.0.1:7890. In the browser, use the system/browser proxy or api-proxy.js.",
    desktopProxyBrowserOnly: "Browser pages cannot switch HTTP/SOCKS5 proxy directly. Use the system/browser proxy or api-proxy.js.",
    desktopProxyTesting: "Testing proxy...", desktopProxyOk: "Proxy test succeeded: {mode} {target}", desktopProxyFailed: "Proxy test failed: {reason}",
    desktopProxyInvalid: "Invalid custom proxy URL. Use http://host:port, https://host:port, or socks5://host:port.",
    connectApi: "Connect API", apiDetect: "Detect", apiConnected: "API connected", apiDisconnected: "API not connected",
    apiConnectHint: "Connect an API, then enter URL, key, and model",
    singleMode: "Single Image", comicMode: "Comic Panels", captionMode: "Caption Mode", prompt: "Prompt", globalPrompt: "Global Prompt",
    globalPromptComic: "Global Prompt (applied to all panels)", globalPromptCaption: "Global Prompt (applied to all images)", importTxt: "Import txt",
    promptPlaceholder: "Describe the image you want to generate. More detail is better...\n\nExample: an orange cat on a windowsill, sunlight through sheer curtains, oil painting style, warm tones",
    globalRefs: "Global reference images (optional, multiple)", uploadRefs: "Click or drag to upload reference images",
    uploadRefsClickOnly: "Click to upload reference images",
    captionUploadHint: "Click or drag to bulk-upload images (generated one at a time in filename order, never bundled into a single request)",
    captionUploadHintClickOnly: "Click to bulk-upload images (generated one at a time in filename order, never bundled into a single request)",
    generateAllCaptions: "Generate All Images",
    matchSize: "Match output size to reference", resolution: "Global Resolution", landscape: "Landscape 3:2", portrait: "Portrait 2:3",
    custom: "Custom", width: "W", height: "H", savedSizes: "Saved sizes", saveSizePreset: "Save size", deleteSizePreset: "Delete saved size", imageCount: "Image Count", sequential: "Generate sequentially",
    sequentialHint: "Unchecked: concurrent batch generation (up to 20 requests at once). Checked: generate one image at a time.",
    panelList: "Panel List", captionList: "Caption List", addPanel: "Add Panel", clear: "Clear", batchCreate: "Batch Create", panelCount: "Panels",
    createBtn: "Create", autoFill: "Auto Fill", fill: "Fill", panelPrompt: "Panel Prompt", retry: "Retry",
    reference: "Reference", generateImage: "Generate Image", generateAll: "Generate All Panels",
    imageFolder: "Image Folder", zipFolder: "ZIP Folder", notSelected: "Not selected", zipName: "ZIP name (optional)...",
    downloadZip: "Download ZIP", saveToFolder: "Save to Folder", savingToFolder: "Saving...", folderSaved: "Saved to folder", clearResults: "Clear Results", emptyTitle: "Generated images will appear here",
    emptyHint: "Enter a prompt on the left and click Generate Image", downloadPaths: "Download Paths",
    imageSaveFolder: "Image save folder", zipSaveFolder: "ZIP save folder", chooseFolder: "Choose Folder",
    historyTitle: "Generation History", historyHint: "Comics are saved as projects. Prompts stay collapsed by default and data is stored in localStorage.",
    searchHistory: "Search prompt / model / date", refresh: "Refresh", autoSaveHistory: "Automatically save successful generations",
    maxRecords: "Maximum records", clearAllHistory: "Clear All Records", autoRetry: "Auto Retry", globalRetries: "Global retries",
    retryHint: "Only HTTP 400 retries automatically. 0 disables auto retry. Per-panel retries override this.",
    restoreProject: "Restore Project", downloadProject: "Export Project", viewPrompts: "View prompts and panels",
    globalPromptLabel: "Global Prompt", panelLabel: "Panel", noPrompt: "No prompt", comicProject: "Comic Project", captionProject: "Caption Project",
    noHistory: "No generation history", expand: "Expand", collapse: "Collapse",
    noImagesToExport: "No images to export", exportOpenedHistory: "Current results are empty. History is open; use Export Project on a project card.", packaging: "Packaging...", preparingZip: "Preparing ZIP...",
    collectingImages: "Collecting images", compressing: "Creating ZIP", zipSaved: "ZIP saved", exportFailed: "Export failed",
    download: "Download", copyLink: "Copy Link", editRetry: "Edit & Retry", reloadImage: "Reload image",
    failReason: "Failure reason", retryFailedAll: "Retry all failed", failedRetryCount: "Failed retry attempts", noFailedToRetry: "No failed panels to retry",
    softwareUpdate: "Software Update", currentVersion: "Current version", latestVersion: "Latest version", updateAsset: "Update asset", notChecked: "Not checked", releaseNotesPlaceholder: "GitHub Release notes appear after checking for updates",
    checkUpdates: "Check updates", downloadUpdate: "Download update", installUpdate: "Download and install",
    updateInitialHint: "Checks GitHub Releases for a new version. Windows exits after download and overwrites the app folder; Android opens the system installer.",
    checkingUpdates: "Checking for updates...", noUpdate: "Already up to date", updateAvailable: "New version available: {version}",
    updateCheckFailed: "Update check failed", noUpdateAsset: "No update package was found for this platform",
    downloadingUpdate: "Downloading update package...", updateDownloaded: "Update package downloaded: {path}",
    updateInstallStarted: "Update install started. Windows will close this app and overwrite the install folder; confirm in the Android installer on Android.",
    updateOpenRelease: "This environment cannot overwrite the app directly, so the update package link was opened.",
    updateOpenGithubMobile: "On Android, please download and install from the GitHub release page. It has been opened for you.",
    updateNowPrompt: "Update now?"
  },
  ja: {
    langZh: "简体", langHant: "繁體", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI 画像生成", subtitle: "単体画像 · 漫画ストーリーボード一括生成",
    web: "Web/PWA", desktop: "デスクトップ", android: "Android",
    create: "作成", panels: "絵コンテ", history: "履歴", export: "書き出し", settings: "設定",
    apiSettings: "API 設定", apiProvider: "API 種類", officialApi: "公式 API", grsaiImageApi: "GrsAI 画像 API", customApi: "カスタム API",
    savedApis: "保存済み API", manualApi: "手動入力", setDefaultApi: "既定", defaultApi: "既定 API",
    apiProviderHint: "推奨画像中継サイト：https://grsai.com/zh。管理はブラウザで開き、アプリ内では遷移しません。",
    apiUrl: "API URL", grsaiEndpoint: "https://grsai.dakka.com.cn/v1/api/generate", grsaiWebsite: "推奨画像中継サイト：https://grsai.com/zh", useGrsaiEndpoint: "GrsAI URL を入力",
    model: "モデル", detect: "検出", proxy: "ブラウザ CORS 転送 URL", saveConfig: "設定を保存",
    modelChoicesPlaceholder: "検出したモデルから選択…",
    desktopProxyTitle: "デスクトップネットワークプロキシ", desktopProxyMode: "プロキシモード", desktopProxyCustomUrl: "カスタムプロキシ URL",
    desktopProxyHttp: "HTTP 127.0.0.1:7890", desktopProxySocks: "SOCKS5 127.0.0.1:10808", desktopProxyDirect: "直結", desktopProxyCustom: "カスタム",
    testDesktopProxy: "プロキシをテスト", desktopProxyHint: "既定は HTTP 127.0.0.1:7890 です。ブラウザではシステム/ブラウザのプロキシまたは api-proxy.js を使用してください。",
    desktopProxyBrowserOnly: "ブラウザページから HTTP/SOCKS5 プロキシは切り替えられません。システム/ブラウザのプロキシまたは api-proxy.js を使用してください。",
    desktopProxyTesting: "プロキシをテスト中...", desktopProxyOk: "プロキシテスト成功：{mode} {target}", desktopProxyFailed: "プロキシテスト失敗：{reason}",
    desktopProxyInvalid: "カスタムプロキシ URL が無効です。http://host:port、https://host:port、socks5://host:port のみ対応しています。",
    connectApi: "API 接続", apiDetect: "検出", apiConnected: "API 接続済み", apiDisconnected: "API 未接続",
    apiConnectHint: "API 接続後、URL、Key、モデルを入力してください",
    singleMode: "単体画像", comicMode: "漫画コマ", captionMode: "テキスト入れモード", prompt: "プロンプト", globalPrompt: "全体プロンプト",
    globalPromptComic: "全体プロンプト（全コマに適用）", globalPromptCaption: "全体プロンプト（全画像に適用）", importTxt: "txt を読み込む",
    promptPlaceholder: "生成したい画像を詳しく説明してください...\n\n例：窓辺のオレンジ色の猫、薄いカーテン越しの光、油絵風、暖色",
    globalRefs: "全体参考画像（任意・複数可）", uploadRefs: "クリックまたはドラッグで参考画像をアップロード",
    uploadRefsClickOnly: "クリックで参考画像をアップロード",
    captionUploadHint: "クリックまたはドラッグで画像を一括アップロード（ファイル名順に1枚ずつ生成、まとめて送信はしません）",
    captionUploadHintClickOnly: "クリックで画像を一括アップロード（ファイル名順に1枚ずつ生成、まとめて送信はしません）",
    generateAllCaptions: "全画像を一括生成",
    matchSize: "出力サイズを参考画像に合わせる", resolution: "全体解像度", landscape: "横 3:2", portrait: "縦 2:3",
    custom: "カスタム", width: "幅", height: "高", savedSizes: "保存サイズ", saveSizePreset: "サイズ保存", deleteSizePreset: "保存サイズ削除", imageCount: "生成数", sequential: "順番に生成",
    sequentialHint: "オフ：並列一括生成（最大同時 20 リクエスト）。オン：1 枚ずつ順番に生成。",
    panelList: "コマ一覧", captionList: "テキスト入れ一覧", addPanel: "コマを追加", clear: "クリア", batchCreate: "一括作成", panelCount: "コマ数",
    createBtn: "作成", autoFill: "自動入力", fill: "入力", panelPrompt: "コマプロンプト", retry: "再試行",
    reference: "参考", generateImage: "画像を生成", generateAll: "全コマを生成",
    imageFolder: "画像フォルダ", zipFolder: "ZIP フォルダ", notSelected: "未選択", zipName: "ZIP 名（任意）...",
    downloadZip: "ZIP ダウンロード", saveToFolder: "フォルダーに保存", savingToFolder: "保存中……", folderSaved: "フォルダーに保存しました", clearResults: "結果をクリア", emptyTitle: "生成画像はここに表示されます",
    emptyHint: "左側にプロンプトを入力し、生成を開始してください", downloadPaths: "保存先",
    imageSaveFolder: "画像保存先", zipSaveFolder: "ZIP 保存先", chooseFolder: "フォルダ選択",
    historyTitle: "生成履歴", historyHint: "漫画はプロジェクトとして保存され、プロンプトは初期状態で折りたたまれます。",
    searchHistory: "プロンプト / モデル / 日付を検索", refresh: "更新", autoSaveHistory: "成功した生成を自動保存",
    maxRecords: "最大記録数", clearAllHistory: "すべて削除", autoRetry: "自動再試行", globalRetries: "全体再試行回数",
    retryHint: "HTTP 400 のみ自動再試行します。0 は無効。コマごとの設定が優先されます。",
    restoreProject: "プロジェクト復元", downloadProject: "プロジェクト書き出し", viewPrompts: "プロンプトとコマを見る",
    globalPromptLabel: "全体プロンプト", panelLabel: "コマ", noPrompt: "プロンプトなし", comicProject: "漫画プロジェクト", captionProject: "テキスト入れプロジェクト",
    noHistory: "生成履歴はありません", expand: "展開", collapse: "折りたたむ",
    noImagesToExport: "書き出せる画像がありません", exportOpenedHistory: "現在の結果は空です。履歴を開いたので、プロジェクトカードの書き出しを使ってください。", packaging: "パッケージ中...", preparingZip: "ZIP 準備中...",
    collectingImages: "画像を収集中", compressing: "ZIP 作成中", zipSaved: "ZIP 保存済み", exportFailed: "書き出し失敗",
    download: "ダウンロード", copyLink: "リンクをコピー", editRetry: "編集して再試行", reloadImage: "画像を再読み込み",
    failReason: "失敗理由", retryFailedAll: "失敗分を再試行", failedRetryCount: "失敗時の再試行回数", noFailedToRetry: "再試行できる失敗コマはありません",
    softwareUpdate: "ソフトウェア更新", currentVersion: "現在のバージョン", latestVersion: "最新バージョン", updateAsset: "更新ファイル", notChecked: "未確認", releaseNotesPlaceholder: "更新確認後に GitHub Release ノートを表示",
    checkUpdates: "更新を確認", downloadUpdate: "更新をダウンロード", installUpdate: "ダウンロードしてインストール",
    updateInitialHint: "GitHub Releases から新しいバージョンを確認します。Windows はダウンロード後に終了してインストール先を上書きし、Android はシステムインストーラを開きます。",
    checkingUpdates: "更新を確認中...", noUpdate: "最新です", updateAvailable: "新しいバージョンがあります: {version}",
    updateCheckFailed: "更新確認に失敗しました", noUpdateAsset: "このプラットフォーム用の更新パッケージが見つかりません",
    downloadingUpdate: "更新パッケージをダウンロード中...", updateDownloaded: "更新パッケージを保存しました: {path}",
    updateInstallStarted: "更新インストールを開始しました。Windows はアプリを閉じてインストール先を上書きします。Android ではインストーラで確認してください。",
    updateOpenRelease: "この環境では直接上書きできないため、更新パッケージのリンクを開きました。",
    updateOpenGithubMobile: "Android 版は GitHub のリリースページからダウンロード・インストールしてください。ページを開きました。",
    updateNowPrompt: "今すぐ更新しますか？"
  },
  ko: {
    langZh: "简体", langHant: "繁體", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI 이미지 생성기", subtitle: "단일 이미지 · 만화 콘티 일괄 생성",
    web: "Web/PWA", desktop: "데스크톱", android: "Android",
    create: "생성", panels: "콘티", history: "기록", export: "내보내기", settings: "설정",
    apiSettings: "API 설정", apiProvider: "API 유형", officialApi: "공식 API", grsaiImageApi: "GrsAI 이미지 API", customApi: "사용자 API",
    savedApis: "저장된 API", manualApi: "직접 입력", setDefaultApi: "기본", defaultApi: "기본 API",
    apiProviderHint: "추천 이미지 중계 사이트: https://grsai.com/zh. 관리는 브라우저에서 열고 앱 안에서는 이동하지 않습니다.",
    apiUrl: "API URL", grsaiEndpoint: "https://grsai.dakka.com.cn/v1/api/generate", grsaiWebsite: "추천 이미지 중계 사이트: https://grsai.com/zh", useGrsaiEndpoint: "GrsAI URL 입력",
    model: "모델", detect: "감지", proxy: "브라우저 CORS 프록시 URL", saveConfig: "설정 저장",
    modelChoicesPlaceholder: "감지된 모델에서 선택...",
    desktopProxyTitle: "데스크톱 네트워크 프록시", desktopProxyMode: "프록시 모드", desktopProxyCustomUrl: "사용자 프록시 URL",
    desktopProxyHttp: "HTTP 127.0.0.1:7890", desktopProxySocks: "SOCKS5 127.0.0.1:10808", desktopProxyDirect: "직접 연결", desktopProxyCustom: "사용자 지정",
    testDesktopProxy: "프록시 테스트", desktopProxyHint: "기본값은 HTTP 127.0.0.1:7890입니다. 브라우저에서는 시스템/브라우저 프록시 또는 api-proxy.js를 사용하세요.",
    desktopProxyBrowserOnly: "브라우저 페이지에서는 HTTP/SOCKS5 프록시를 직접 전환할 수 없습니다. 시스템/브라우저 프록시 또는 api-proxy.js를 사용하세요.",
    desktopProxyTesting: "프록시 테스트 중...", desktopProxyOk: "프록시 테스트 성공: {mode} {target}", desktopProxyFailed: "프록시 테스트 실패: {reason}",
    desktopProxyInvalid: "사용자 프록시 URL이 잘못되었습니다. http://host:port, https://host:port, socks5://host:port만 지원합니다.",
    connectApi: "API 연결", apiDetect: "감지", apiConnected: "API 연결됨", apiDisconnected: "API 미연결",
    apiConnectHint: "API를 연결한 뒤 URL, Key, 모델을 입력하세요",
    singleMode: "단일 이미지", comicMode: "만화 콘티", captionMode: "말풍선 모드", prompt: "프롬프트", globalPrompt: "전체 프롬프트",
    globalPromptComic: "전체 프롬프트(모든 콘티에 적용)", globalPromptCaption: "전체 프롬프트(모든 이미지에 적용)", importTxt: "txt 가져오기",
    promptPlaceholder: "생성할 이미지를 자세히 설명하세요...\n\n예: 창가에 앉은 주황색 고양이, 커튼 사이로 비치는 햇빛, 유화 스타일, 따뜻한 톤",
    globalRefs: "전체 참고 이미지(선택, 다중)", uploadRefs: "클릭하거나 드래그해 참고 이미지 업로드",
    uploadRefsClickOnly: "클릭하여 참고 이미지 업로드",
    captionUploadHint: "클릭하거나 드래그해 이미지를 일괄 업로드(파일명 순서대로 한 장씩 생성하며, 한 번에 묶어서 보내지 않음)",
    captionUploadHintClickOnly: "클릭하여 이미지를 일괄 업로드(파일명 순서대로 한 장씩 생성하며, 한 번에 묶어서 보내지 않음)",
    generateAllCaptions: "전체 이미지 일괄 생성",
    matchSize: "출력 크기를 참고 이미지와 맞춤", resolution: "전체 해상도", landscape: "가로 3:2", portrait: "세로 2:3",
    custom: "사용자 지정", width: "너비", height: "높이", savedSizes: "저장 크기", saveSizePreset: "크기 저장", deleteSizePreset: "저장 크기 삭제", imageCount: "생성 수", sequential: "순차 생성",
    sequentialHint: "선택 해제: 동시 일괄 생성(최대 동시 20개 요청). 선택: 한 장씩 순차 생성.",
    panelList: "콘티 목록", captionList: "말풍선 목록", addPanel: "콘티 추가", clear: "비우기", batchCreate: "일괄 생성", panelCount: "콘티 수",
    createBtn: "생성", autoFill: "자동 입력", fill: "입력", panelPrompt: "콘티 프롬프트", retry: "재시도",
    reference: "참고", generateImage: "이미지 생성", generateAll: "모든 콘티 생성",
    imageFolder: "이미지 폴더", zipFolder: "ZIP 폴더", notSelected: "선택 안 됨", zipName: "ZIP 이름(선택)...",
    downloadZip: "ZIP 다운로드", saveToFolder: "폴더에 저장", savingToFolder: "저장 중……", folderSaved: "폴더에 저장됨", clearResults: "결과 비우기", emptyTitle: "생성된 이미지가 여기에 표시됩니다",
    emptyHint: "왼쪽에 프롬프트를 입력하고 생성 버튼을 누르세요", downloadPaths: "다운로드 경로",
    imageSaveFolder: "이미지 저장 폴더", zipSaveFolder: "ZIP 저장 폴더", chooseFolder: "폴더 선택",
    historyTitle: "생성 기록", historyHint: "만화는 프로젝트로 저장되며 프롬프트는 기본적으로 접혀 있습니다.",
    searchHistory: "프롬프트 / 모델 / 날짜 검색", refresh: "새로고침", autoSaveHistory: "성공한 생성 자동 저장",
    maxRecords: "최대 기록 수", clearAllHistory: "모든 기록 삭제", autoRetry: "자동 재시도", globalRetries: "전체 재시도 횟수",
    retryHint: "HTTP 400만 자동 재시도합니다. 0은 비활성화입니다. 콘티별 설정이 우선합니다.",
    restoreProject: "프로젝트 복원", downloadProject: "프로젝트 내보내기", viewPrompts: "프롬프트와 콘티 보기",
    globalPromptLabel: "전체 프롬프트", panelLabel: "콘티", noPrompt: "프롬프트 없음", comicProject: "만화 프로젝트", captionProject: "말풍선 프로젝트",
    noHistory: "생성 기록 없음", expand: "펼치기", collapse: "접기",
    noImagesToExport: "내보낼 이미지가 없습니다", exportOpenedHistory: "현재 결과가 비어 있어 기록을 열었습니다. 프로젝트 카드에서 프로젝트 내보내기를 사용하세요.", packaging: "패키징 중...", preparingZip: "ZIP 준비 중...",
    collectingImages: "이미지 수집 중", compressing: "ZIP 생성 중", zipSaved: "ZIP 저장됨", exportFailed: "내보내기 실패",
    download: "다운로드", copyLink: "링크 복사", editRetry: "편집 후 재시도", reloadImage: "이미지 다시 불러오기",
    failReason: "실패 원인", retryFailedAll: "실패 항목 재시도", failedRetryCount: "실패 재시도 횟수", noFailedToRetry: "재시도할 실패 콘티가 없습니다",
    softwareUpdate: "소프트웨어 업데이트", currentVersion: "현재 버전", latestVersion: "최신 버전", updateAsset: "업데이트 파일", notChecked: "확인 안 됨", releaseNotesPlaceholder: "업데이트 확인 후 GitHub Release 설명 표시",
    checkUpdates: "업데이트 확인", downloadUpdate: "업데이트 다운로드", installUpdate: "다운로드 및 설치",
    updateInitialHint: "GitHub Releases에서 새 버전을 확인합니다. Windows는 다운로드 후 종료하고 설치 폴더를 덮어쓰며, Android는 시스템 설치 관리자를 엽니다.",
    checkingUpdates: "업데이트 확인 중...", noUpdate: "최신 버전입니다", updateAvailable: "새 버전 발견: {version}",
    updateCheckFailed: "업데이트 확인 실패", noUpdateAsset: "현재 플랫폼용 업데이트 패키지를 찾지 못했습니다",
    downloadingUpdate: "업데이트 패키지 다운로드 중...", updateDownloaded: "업데이트 패키지 다운로드됨: {path}",
    updateInstallStarted: "업데이트 설치가 시작되었습니다. Windows는 앱을 닫고 설치 폴더를 덮어씁니다. Android에서는 설치 관리자에서 확인하세요.",
    updateOpenRelease: "현재 환경에서는 직접 덮어쓸 수 없어 업데이트 패키지 링크를 열었습니다.",
    updateOpenGithubMobile: "Android 버전은 GitHub 릴리스 페이지에서 다운로드 및 설치해주세요. 페이지를 열었습니다.",
    updateNowPrompt: "지금 업데이트하시겠습니까?"
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
    dom.languageSelect.title = "Language";
  }
  if (dom.languageCurrent) dom.languageCurrent.textContent = langNames[currentLanguage] || cleanText("langZh");
  if (dom.languageMenu) {
    Object.entries(langNames).forEach(([value, label]) => {
      const option = dom.languageMenu.querySelector(`[data-lang="${value}"]`);
      if (!option) return;
      option.textContent = label;
      option.classList.toggle("active", value === currentLanguage);
      option.setAttribute("aria-selected", value === currentLanguage ? "true" : "false");
    });
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
  setText("#apiProviderField > span", "apiProvider");
  const providerLabels = {
    official: "officialApi",
    grsai: "grsaiImageApi",
    custom: "customApi",
  };
  Object.entries(providerLabels).forEach(([value, key]) => {
    const option = dom.apiProvider?.querySelector(`option[value="${value}"]`);
    if (option) option.textContent = cleanText(key);
  });
  customSelects.apiProvider?.syncLabel();
  setText("#apiProviderHint", "apiProviderHint");
  setText("#savedApiField > span", "savedApis");
  const manual = dom.savedApis?.querySelector('option[value=""]');
  if (manual) manual.textContent = cleanText("manualApi");
  customSelects.savedApis?.syncLabel();
  setButtonText(dom.setDefaultApi, "save", "setDefaultApi");
  setText("#apiEndpointField > span", "apiUrl");
  setText(".grsai-tip span", "grsaiWebsite");
  setButtonText($("#useGrsaiEndpoint"), "spark", "useGrsaiEndpoint");
  setText("#modelField > span", "model");
  setButtonText(dom.detectModels, "search", "detect");
  const modelChoicesPlaceholder = dom.modelChoices?.querySelector('option[value=""]');
  if (modelChoicesPlaceholder) modelChoicesPlaceholder.textContent = cleanText("modelChoicesPlaceholder");
  customSelects.modelChoices?.syncLabel();
  setText("#proxyEndpointField > span", "proxy");
  setButtonText(dom.saveConfig, "save", "saveConfig");
  setButtonText(dom.openApiConfig, "settings", "connectApi");
  setButtonText(dom.quickDetectModels, "search", "apiDetect");
  updateApiQuickState();

  $$(".mode-tab", dom.modeTabs).forEach(tab => {
    const iconKey = tab.dataset.mode === "comic" ? "comic" : tab.dataset.mode === "caption" ? "bubble" : "image";
    const labelKey = tab.dataset.mode === "comic" ? "comicMode" : tab.dataset.mode === "caption" ? "captionMode" : "singleMode";
    setButtonText(tab, iconKey, labelKey);
  });

  const isComic = currentMode === "comic";
  const isCaption = currentMode === "caption";
  setText("#globalPromptField .field-label-text", isComic ? "globalPromptComic" : isCaption ? "globalPromptCaption" : "prompt");
  setButtonText(dom.importTxt, "file", "importTxt");
  if (dom.prompt) dom.prompt.placeholder = cleanText("promptPlaceholder");
  setText(".image-upload .upload-zone span:last-child", isDragDropUnsupported() ? "uploadRefsClickOnly" : "uploadRefs");
  setText("#captionUploadZone span:last-child", isDragDropUnsupported() ? "captionUploadHintClickOnly" : "captionUploadHint");
  setIconLabel("#useOrigSizeToggle > span", "size", "matchSize");
  setText("fieldset.field > legend", "resolution");
  setText(".size-option:nth-child(2) small", "landscape");
  setText(".size-option:nth-child(3) small", "portrait");
  setText(".size-custom > span:first-of-type", "custom");
  setAttr("#customWidth", "placeholder", "width");
  setAttr("#customHeight", "placeholder", "height");
  const savedSizesFirstOption = dom.savedSizes?.querySelector('option[value=""]');
  if (savedSizesFirstOption) savedSizesFirstOption.textContent = cleanText("savedSizes");
  customSelects.savedSizes?.syncLabel();
  setButtonText(dom.saveSizePreset, "save", "saveSizePreset");
  if (dom.deleteSizePreset) dom.deleteSizePreset.title = cleanText("deleteSizePreset");
  setText("#nImagesField > span", "imageCount");
  setText("#sequentialToggle > span", "sequential");
  setText("#sequentialModeHint", "sequentialHint");

  setIconLabel("#comicPanelSection .section-header > span", "comic", "panelList");
  setButtonText(dom.addPanel, "plus", "addPanel");
  if (dom.clearPanels) dom.clearPanels.textContent = cleanText("clear");
  setIconLabel("#captionSection .section-header > span", "bubble", "captionList");
  if (dom.clearCaptionRows) dom.clearCaptionRows.textContent = cleanText("clear");
  setText(".tool-group:nth-child(1) .tool-label", "batchCreate");
  setText(".panel-count-control > span", "panelCount");
  if (dom.createPanels) dom.createPanels.textContent = cleanText("createBtn");
  setText(".tool-group-fill .tool-label", "autoFill");
  setButtonText(dom.autoFillPanels, "spark", "fill");
  setText(".panel-table th.col-prompt", "panelPrompt");
  setText(".panel-table th.col-size", "resolution");
  setText(".panel-table th.col-retry", "retry");
  setText(".panel-table th.col-img", "reference");

  setButtonText(dom.generateBtn, "spark", isComic ? "generateAll" : isCaption ? "generateAllCaptions" : "generateImage");
  setButtonText(dom.chooseImageDir, "image", "imageFolder");
  setButtonText(dom.chooseZipDir, "zip", "zipFolder");
  setButtonText(dom.downloadZip, "zip", "downloadZip");
  setButtonText(dom.saveComicFolder, "folder", "saveToFolder");
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
  setText(".proxy-settings h3", "desktopProxyTitle");
  setText(".proxy-settings .field:nth-of-type(1) span", "desktopProxyMode");
  setText(".proxy-settings .field:nth-of-type(2) span", "desktopProxyCustomUrl");
  const proxyLabels = {
    http7890: "desktopProxyHttp",
    socks10808: "desktopProxySocks",
    direct: "desktopProxyDirect",
    custom: "desktopProxyCustom",
  };
  Object.entries(proxyLabels).forEach(([value, key]) => {
    const option = dom.desktopProxyMode?.querySelector(`option[value="${value}"]`);
    if (option) option.textContent = cleanText(key);
  });
  customSelects.desktopProxyMode?.syncLabel();
  setButtonText(dom.testDesktopProxy, "search", "testDesktopProxy");
  if (dom.desktopProxyStatus && !dom.desktopProxyStatus.dataset.customStatus) {
    dom.desktopProxyStatus.textContent = cleanText("desktopProxyHint");
  }
  setText(".update-settings h3", "softwareUpdate");
  setText(".update-settings .update-version-row:nth-of-type(1) span", "currentVersion");
  setText(".update-settings .update-version-row:nth-of-type(2) span", "latestVersion");
  setText(".update-settings .update-version-row:nth-of-type(3) span", "updateAsset");
  if (dom.currentVersionLabel) dom.currentVersionLabel.textContent = `v${APP_VERSION}`;
  if (dom.latestVersionLabel && !latestUpdateRelease) dom.latestVersionLabel.textContent = cleanText("notChecked");
  if (dom.updateAssetLabel && !latestUpdateRelease) dom.updateAssetLabel.textContent = cleanText("notChecked");
  if (dom.updateNotes && !dom.updateNotes.value) dom.updateNotes.placeholder = cleanText("releaseNotesPlaceholder");
  setButtonText(dom.checkUpdates, "search", "checkUpdates");
  setButtonText(dom.installUpdate, "spark", "installUpdate");
  if (dom.updateStatus && !dom.updateStatus.dataset.customStatus) dom.updateStatus.textContent = cleanText("updateInitialHint");
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
    applyCleanLanguage();
    renderSavedApis();
    renderSavedSizes?.();
    updateApiProviderHint(dom.apiProvider?.value || "custom");
    updateApiQuickState();
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
  dom.languageMenuButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const isOpen = !dom.languageMenu?.classList.contains("hidden");
    setLanguageMenuOpen(!isOpen);
  });
  dom.languageMenu?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-lang]");
    if (!option) return;
    event.preventDefault();
    event.stopPropagation();
    applyLanguage(option.dataset.lang);
    setLanguageMenuOpen(false);
  });
  document.addEventListener("click", (event) => {
    if (!dom.languageControl?.contains(event.target)) setLanguageMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setLanguageMenuOpen(false);
  });
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

function setLanguageMenuOpen(open) {
  if (!dom.languageMenu || !dom.languageMenuButton) return;
  dom.languageMenu.classList.toggle("hidden", !open);
  dom.languageControl?.classList.toggle("is-open", open);
  dom.languageMenuButton.setAttribute("aria-expanded", open ? "true" : "false");
}

// ─── DOM 引用 ──────────────────────────────────────────────
const dom = {
  // 配置
  apiProvider:   $("#apiProvider"),
  apiEndpoint:   $("#apiEndpoint"),
  apiKey:        $("#apiKey"),
  model:         $("#model"),
  proxyEndpoint: $("#proxyEndpoint"),
  modelChoices:  $("#modelChoices"),
  detectModels:  $("#detectModels"),
  saveConfig:    $("#saveConfig"),
  savedApis:     $("#savedApis"),
  setDefaultApi: $("#setDefaultApi"),
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
  inputPanel:    $(".input-panel"),
  modeTabs:      $("#modeTabs"),
  // 全局输入
  prompt:        $("#prompt"),
  importTxt:     $("#importTxt"),
  txtFileInput:  $("#txtFileInput"),
  promptHint:    $("#promptHint"),
  referenceField: $("#referenceField"),
  refImage:      $("#refImage"),
  uploadZone:    $("#uploadZone"),
  thumbGrid:     $("#thumbGrid"),
  useOrigSize:   $("#useOrigSize"),
  customWidth:   $("#customWidth"),
  customHeight:  $("#customHeight"),
  savedSizes:    $("#savedSizes"),
  saveSizePreset:$("#saveSizePreset"),
  deleteSizePreset:$("#deleteSizePreset"),
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
  // 嵌字专属
  captionSection: $("#captionSection"),
  captionUploadZone: $("#captionUploadZone"),
  captionBulkInput: $("#captionBulkInput"),
  captionTbody:  $("#captionTbody"),
  clearCaptionRows: $("#clearCaptionRows"),
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
  saveComicFolder: $("#saveComicFolder"),
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
  languageControl:$("#languageControl"),
  languageMenuButton:$("#languageMenuButton"),
  languageCurrent:$("#languageCurrent"),
  languageMenu:  $("#languageMenu"),
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
  desktopProxyMode: $("#desktopProxyMode"),
  desktopProxyCustomUrl: $("#desktopProxyCustomUrl"),
  testDesktopProxy: $("#testDesktopProxy"),
  desktopProxyStatus: $("#desktopProxyStatus"),
  clearHistory:   $("#clearHistory"),
  currentVersionLabel: $("#currentVersionLabel"),
  latestVersionLabel:  $("#latestVersionLabel"),
  updateAssetLabel:    $("#updateAssetLabel"),
  updateNotes:         $("#updateNotes"),
  updateStatus:        $("#updateStatus"),
  checkUpdates:        $("#checkUpdates"),
  installUpdate:       $("#installUpdate"),
  // 历史
  historyBtn:    $("#historyBtn"),
  historyModal:  $("#historyModal"),
  closeHistory:  $("#closeHistory"),
  historySearch: $("#historySearch"),
  refreshHistory:$("#refreshHistory"),
  historyList:   $("#historyList"),
};

// ─── 自绘下拉列表（替代原生 <select>，Windows exe 端原生弹出层不可用）──────
// webview_windows 在 Windows 端是离屏渲染 WebView2（截屏合成到 Flutter），原生
// <select> 展开的选项列表是 Chromium 内部另开的 OS 弹出窗口，不在被截屏的离屏
// 表面里，因此打包后的 exe 完全不显示/错位，还可能吃掉输入焦点导致页面卡死没
// 反应。HTML/浏览器端因为是真实浏览器渲染原生弹出层，不受影响。所以这个问题只
// 在 exe 端出现，浏览器端一直是正常的。
// 这里把原生 <select> 隐藏保留作为状态源（各处已有的 .value / addEventListener
// change 逻辑完全不用改），上面盖一层自己画的按钮 + 列表，点击自绘选项时改写
// select.value 并派发 change 事件驱动原逻辑。
const _customSelectRegistry = [];
function initCustomSelect(selectEl) {
  if (!selectEl) return null;
  const trigger = document.getElementById(selectEl.id + "Trigger");
  const wrapper = document.getElementById(selectEl.id + "CustomSelect");
  const list = document.getElementById(selectEl.id + "CustomList");
  if (!trigger || !wrapper || !list) return null;
  const valueLabel = trigger.querySelector(".custom-select-value");

  function renderOptions() {
    list.innerHTML = "";
    [...selectEl.options].forEach(opt => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "custom-select-option";
      btn.setAttribute("role", "option");
      btn.textContent = opt.textContent;
      btn.setAttribute("aria-selected", opt.value === selectEl.value ? "true" : "false");
      btn.addEventListener("click", () => {
        if (selectEl.value !== opt.value) {
          selectEl.value = opt.value;
          selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
        close();
        trigger.focus();
      });
      list.appendChild(btn);
    });
  }
  function syncLabel() {
    const opt = selectEl.options[selectEl.selectedIndex];
    if (valueLabel) valueLabel.textContent = opt ? opt.textContent : "";
  }
  function isOpen() { return !list.classList.contains("hidden"); }
  function open() {
    _customSelectRegistry.forEach(inst => { if (inst.close !== close) inst.close(); });
    renderOptions();
    list.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
  }
  function close() {
    list.classList.add("hidden");
    trigger.setAttribute("aria-expanded", "false");
  }
  trigger.addEventListener("click", () => { isOpen() ? close() : open(); });
  selectEl.addEventListener("change", syncLabel);
  syncLabel();
  const instance = { wrapper, close, isOpen, syncLabel, renderOptions };
  _customSelectRegistry.push(instance);
  return instance;
}

// 模型字段是个特例：没有单独的下拉触发器/展开框，#model 输入框本身就是触发器——
// 点击它就弹出检测到的模型列表（跟其它 .custom-select 视觉一致，共用同一套
// 外部点击/Escape 关闭逻辑），选中后填入输入框；输入框本身依然可以手动打字输入
// 任意自定义模型名，两者不冲突。
function initModelCombobox(selectEl, inputEl) {
  if (!selectEl || !inputEl) return null;
  const list = document.getElementById(selectEl.id + "CustomList");
  if (!list) return null;

  function renderOptions() {
    list.innerHTML = "";
    [...selectEl.options].forEach(opt => {
      if (!opt.value) return; // 跳过"从检测到的模型中选择…"占位项，手动打字场景不需要它
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "custom-select-option";
      btn.setAttribute("role", "option");
      btn.textContent = opt.textContent;
      btn.setAttribute("aria-selected", opt.value === inputEl.value ? "true" : "false");
      btn.addEventListener("click", () => {
        selectEl.value = opt.value;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        close();
        inputEl.focus();
      });
      list.appendChild(btn);
    });
  }
  function isOpen() { return !list.classList.contains("hidden"); }
  function open() {
    if (![...selectEl.options].some(opt => opt.value)) return;
    _customSelectRegistry.forEach(inst => { if (inst.close !== close) inst.close(); });
    renderOptions();
    list.classList.remove("hidden");
    inputEl.setAttribute("aria-expanded", "true");
  }
  function close() {
    list.classList.add("hidden");
    inputEl.setAttribute("aria-expanded", "false");
  }
  inputEl.addEventListener("click", () => { isOpen() ? close() : open(); });
  inputEl.addEventListener("input", () => { if (isOpen()) close(); });
  const instance = { wrapper: inputEl.closest(".model-input-row") || inputEl, close, isOpen, syncLabel: () => {}, renderOptions };
  _customSelectRegistry.push(instance);
  return instance;
}

document.addEventListener("click", e => {
  _customSelectRegistry.forEach(inst => { if (inst.isOpen() && !inst.wrapper.contains(e.target)) inst.close(); });
}, true);
document.addEventListener("keydown", e => {
  if (e.key === "Escape") _customSelectRegistry.forEach(inst => inst.close());
});

const customSelects = {
  apiProvider: initCustomSelect(dom.apiProvider),
  savedApis: initCustomSelect(dom.savedApis),
  nImages: initCustomSelect(dom.nImages),
  savedSizes: initCustomSelect(dom.savedSizes),
  autoFillTemplate: initCustomSelect(dom.autoFillTemplate),
  desktopProxyMode: initCustomSelect(dom.desktopProxyMode),
  modelChoices: initModelCombobox(dom.modelChoices, dom.model),
};

dom.modelChoices?.addEventListener("change", () => {
  if (!dom.modelChoices.value) return;
  dom.model.value = dom.modelChoices.value;
  dom.model.dispatchEvent(new Event("change", { bubbles: true }));
  updateApiQuickState();
});

// ─── 状态 ──────────────────────────────────────────────────
let currentMode = "single";   // "single" | "comic" | "caption"
let panelCounter = 0;         // 分镜自增编号
let captionRowCounter = 0;    // 嵌字行自增编号
let abortController = null;   // 用于取消批量生成
let activeGenerationId = 0;    // 用于丢弃已取消/过期的生成结果
let importedTxtFiles = [];      // { name, content } —— 导入的多个 txt 文件
let referenceImages = [];       // { file, dataUrl, width, height } —— 多张参考图片
let generatedImageUrls = [];
let appWasBackgrounded = false;
let retryAllFailedInProgress = false;
let currentComicHistoryId = null; // 当前结果网格对应的漫画项目历史记录 id（新生成/恢复历史时更新），
                                    // 重试某个分镜时用它定位到要更新的那条历史记录，而不是留着旧图不管
let latestUpdateRelease = null;
let latestUpdateInfo = null;

function canScrollVertically(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const style = getComputedStyle(el);
  return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2;
}

function scrollElementByWheelDelta(el, deltaY) {
  if (!el || !Number.isFinite(deltaY)) return false;
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  if (max <= 0) return false;
  const next = Math.max(0, Math.min(max, el.scrollTop + deltaY));
  if (next === el.scrollTop) return false;
  el.scrollTop = next;
  return true;
}

function getWheelDeltaY(event, target = null) {
  const raw = Number(event?.deltaY || 0);
  if (!Number.isFinite(raw) || raw === 0) return 0;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    const lineHeight = Number.parseFloat(getComputedStyle(target || document.body).lineHeight);
    return raw * (Number.isFinite(lineHeight) ? lineHeight : 16);
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return raw * Math.max(1, target?.clientHeight || window.innerHeight || 800);
  }
  return raw;
}

// webview_windows 转发滚轮事件时不带光标坐标（上游 #313），实测中 event.target 有时会落在
// 光标视觉位置之外的元素上（比如鼠标明明在 #modelChoices 列表里，target 却是 .input-panel 或更
// 外层的容器），导致沿 target 网上找可滚祖先时根本找不到光标真正悬停的那个嵌套滚动区域。
//
// 光靠 event.clientX/clientY 重新 hit-test 只能部分解决问题：如果这个插件转发滚轮事件时坐标
// 本身也不准（不只是 target 不准），用同一个事件自带的坐标再做一次 hit-test 还是会落在错误
// 位置——排查过多轮后确认这是真实存在的情况，不能只信任 wheel 事件自己携带的任何信息。
// 用一个独立于 wheel 事件的 mousemove 监听器持续记录"最后一次已知的真实光标位置"，鼠标移动
// 是比滚轮更基础、更不容易被插件转发链路影响的事件，优先用这个位置做 hit-test；wheel 事件自
// 带的坐标降级为第二选择，event.target 是最后兜底。
let _lastKnownPointerX = null;
let _lastKnownPointerY = null;
document.addEventListener("mousemove", e => {
  _lastKnownPointerX = e.clientX;
  _lastKnownPointerY = e.clientY;
}, { passive: true, capture: true });

function resolveWheelEventStartElement(event) {
  if (Number.isFinite(_lastKnownPointerX) && Number.isFinite(_lastKnownPointerY)) {
    const atTrackedPoint = document.elementFromPoint(_lastKnownPointerX, _lastKnownPointerY);
    if (atTrackedPoint) return atTrackedPoint;
  }
  const x = event?.clientX;
  const y = event?.clientY;
  if (Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0)) {
    const atPoint = document.elementFromPoint(x, y);
    if (atPoint) return atPoint;
  }
  return event?.target || null;
}

function isOverlayVisible(overlay) {
  return !!overlay && overlay.isConnected && !overlay.classList.contains("hidden");
}

function getVisibleBlockingOverlays() {
  // 打开的下拉列表（.custom-select-list）也算进来：就算坐标纠正最终还是没能定位到该滚动
  // 的元素，至少能靠这里的兜底逻辑拦住事件、不让它继续冒泡去滚背后的主面板——"滚不动"比
  // "滚错地方"体验上更能接受，且不会有更差的后果。
  const openCustomSelectLists = _customSelectRegistry
    .filter(inst => inst.isOpen())
    .map(inst => inst.wrapper.querySelector(".custom-select-list"))
    .filter(Boolean);
  return [dom.settingsModal, dom.historyModal, ...$$(".ask-dialog-overlay"), ...$$(".lightbox"), ...openCustomSelectLists]
    .filter(isOverlayVisible);
}

function getTopVisibleOverlay() {
  const overlays = getVisibleBlockingOverlays();
  if (!overlays.length) return null;
  return overlays.reduce((top, overlay) => {
    const topZ = Number.parseInt(getComputedStyle(top).zIndex, 10) || 0;
    const z = Number.parseInt(getComputedStyle(overlay).zIndex, 10) || 0;
    if (z > topZ) return overlay;
    if (z === topZ && top.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING) return overlay;
    return top;
  }, overlays[0]);
}

function getOverlayPrimaryScroller(overlay) {
  if (!isOverlayVisible(overlay)) return null;
  const preferred = $(".modal-card", overlay) || overlay;
  if (canScrollVertically(preferred)) return preferred;
  const descendants = $$("*", overlay);
  for (const node of descendants) {
    if (canScrollVertically(node)) return node;
  }
  return null;
}

function updateBodyScrollLock() {
  document.body.style.overflow = getTopVisibleOverlay() ? "hidden" : "";
}

function getScrollableAncestor(node) {
  let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  while (el && el !== document.body && el !== document.documentElement) {
    if (canScrollVertically(el)) return el;
    el = el.parentElement;
  }
  return null;
}

function installGlobalWheelScrollBridge() {
  window.addEventListener("wheel", event => {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (getTopVisibleOverlay()) return;
    const activeScroller = getScrollableAncestor(resolveWheelEventStartElement(event));
    if (activeScroller) return;
    const panel = dom.inputPanel;
    if (scrollElementByWheelDelta(panel, getWheelDeltaY(event, panel))) event.preventDefault();
  }, { passive: false });
}

installGlobalWheelScrollBridge();

// ─── 配置管理 ──────────────────────────────────────────────
const STORAGE_KEY = "ai_image_gen_config";
const DEFAULT_API_KEY = "ai_image_gen_default_api_id";
const OFFICIAL_API_ENDPOINT = "https://api.openai.com/v1/images/generations";
const GRSAI_SITE_URL = "https://grsai.com/zh";
const GRSAI_API_ENDPOINT = "https://grsai.dakka.com.cn/v1/api/generate";
const API_PROVIDER_PRESETS = {
  official: { endpoint: OFFICIAL_API_ENDPOINT, labelKey: "officialApi" },
  grsai: { endpoint: GRSAI_API_ENDPOINT, labelKey: "grsaiImageApi" },
  custom: { endpoint: "", labelKey: "customApi" },
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    if (saved?.endpoint) return saved;
    return getDefaultApiConfig() || saved || {};
  } catch {
    return getDefaultApiConfig() || {};
  }
}
function saveConfig(config) { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeApiConfig(config))); }
function clearConfig() { localStorage.removeItem(STORAGE_KEY); }

function makeApiId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `api_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeApiConfig(config = {}) {
  const endpoint = String(config.endpoint || "").trim();
  const apiProvider = config.apiProvider || config.provider || inferApiProvider(endpoint);
  return {
    id: config.id || makeApiId(),
    name: config.name || readableEndpoint(endpoint) || cleanText("manualApi"),
    apiProvider,
    endpoint,
    apiKey: config.apiKey || "",
    model: config.model || "",
    proxyEndpoint: config.proxyEndpoint || "",
    platform: config.platform || apiProviderLabel(apiProvider) || readableEndpoint(endpoint) || cleanText("customApi"),
  };
}

function loadDefaultApiId() {
  return localStorage.getItem(DEFAULT_API_KEY) || "";
}

function saveDefaultApiId(id) {
  if (id) localStorage.setItem(DEFAULT_API_KEY, id);
  else localStorage.removeItem(DEFAULT_API_KEY);
}

function getDefaultApiConfig() {
  const id = loadDefaultApiId();
  if (!id) return null;
  return loadAllApis().find(api => api.id === id) || null;
}

function inferApiProvider(endpoint = "") {
  const ep = String(endpoint).toLowerCase();
  if (/grsai|dakka\.com\.cn|grsaiapi/.test(ep)) return "grsai";
  if (/api\.openai\.com/.test(ep)) return "official";
  return "custom";
}

function isPresetEndpoint(endpoint = "") {
  const clean = String(endpoint).trim().replace(/\/+$/, "");
  return Object.values(API_PROVIDER_PRESETS).some(p => p.endpoint && p.endpoint.replace(/\/+$/, "") === clean);
}

function apiProviderLabel(provider) {
  return cleanText(API_PROVIDER_PRESETS[provider]?.labelKey || "customApi");
}

function updateApiProviderHint(provider = dom.apiProvider?.value || "custom") {
  if (!$("#apiProviderHint")) return;
  const hints = {
    official: `${cleanText("officialApi")} · ${OFFICIAL_API_ENDPOINT}`,
    grsai: cleanText("apiProviderHint"),
    custom: `${cleanText("customApi")} · ${cleanText("apiUrl")}`,
  };
  $("#apiProviderHint").textContent = hints[provider] || hints.custom;
}

function applyApiProvider(provider = "custom", options = {}) {
  const next = API_PROVIDER_PRESETS[provider] ? provider : "custom";
  if (dom.apiProvider) dom.apiProvider.value = next;
  const preset = API_PROVIDER_PRESETS[next];
  const shouldSetEndpoint = options.forceEndpoint || (!dom.apiEndpoint?.value.trim() && next !== "custom");
  if (shouldSetEndpoint && preset.endpoint) dom.apiEndpoint.value = preset.endpoint;
  if (next === "custom" && options.forceEndpoint && isPresetEndpoint(dom.apiEndpoint.value)) {
    dom.apiEndpoint.value = "";
  }
  if (dom.apiEndpoint) {
    dom.apiEndpoint.readOnly = next !== "custom";
    dom.apiEndpoint.placeholder = preset.endpoint || "https://your-api.example.com/v1/images/generations";
  }
  updateApiProviderHint(next);
  updateApiQuickState();
}

function applyConfig(cfg) {
  const endpoint = cfg.endpoint || API_PROVIDER_PRESETS[cfg.apiProvider || "grsai"]?.endpoint || "";
  const provider = cfg.apiProvider || cfg.provider || inferApiProvider(endpoint);
  applyApiProvider(provider, { forceEndpoint: false });
  if (endpoint) dom.apiEndpoint.value = endpoint;
  if (cfg.apiKey)   dom.apiKey.value = cfg.apiKey;
  if (cfg.model)    dom.model.value = cfg.model;
  if (cfg.proxyEndpoint) dom.proxyEndpoint.value = cfg.proxyEndpoint;
  if (!cfg.model && provider === "grsai") dom.model.placeholder = "点击输入或检测选择模型";
  updateApiQuickState();
}

function currentApiConfig(name = loadConfig().name || "") {
  const endpoint = dom.apiEndpoint.value.trim();
  const active = loadConfig();
  const provider = dom.apiProvider?.value || inferApiProvider(endpoint);
  return {
    id: active.id || makeApiId(),
    name: name || readableEndpoint(endpoint) || "未命名",
    apiProvider: provider,
    endpoint,
    apiKey: dom.apiKey.value.trim(),
    model: dom.model.value.trim(),
    proxyEndpoint: dom.proxyEndpoint.value.trim(),
    platform: (findAdapter(endpoint, provider) || {}).name || "未知",
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
      const provider = dom.apiProvider?.value || inferApiProvider(endpoint);
      try {
        adapter = findAdapter(endpoint, provider);
      } catch {
        adapter = null;
      }
      const platform = apiProviderLabel(provider) || adapter?.name || readableEndpoint(endpoint);
      dom.apiQuickMeta.textContent = `${platform} · ${model} · ${maskApiKey(apiKey)}`;
    } else {
      const provider = apiProviderLabel(dom.apiProvider?.value || inferApiProvider(endpoint));
      dom.apiQuickMeta.textContent = `${provider} · ${cleanText("apiConnectHint")}`;
    }
  }
}

const STORAGE_APIS = "ai_image_gen_apis";

function loadAllApis() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_APIS) || "[]");
    return Array.isArray(raw) ? raw.map(normalizeApiConfig) : [];
  }
  catch { return []; }
}
function saveAllApis(list) { localStorage.setItem(STORAGE_APIS, JSON.stringify(list)); }

function renderSavedApis() {
  const apis = loadAllApis();
  const defaultId = loadDefaultApiId();
  dom.savedApis.innerHTML = `<option value="">${cleanText("manualApi")}</option>`;
  apis.forEach((api, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.dataset.apiId = api.id;
    opt.textContent = `${api.id === defaultId ? "★ " : ""}${api.name || api.endpoint}`;
    dom.savedApis.appendChild(opt);
  });
  customSelects.savedApis?.syncLabel();
}

function findSavedApiIndex(value, apis = loadAllApis()) {
  if (!value && value !== 0) return -1;
  const asString = String(value);
  const byId = apis.findIndex(api => api.id === asString);
  if (byId >= 0) return byId;
  if (/^\d+$/.test(asString)) {
    const byLegacyIndex = Number(asString);
    if (byLegacyIndex >= 0 && byLegacyIndex < apis.length) return byLegacyIndex;
  }
  return -1;
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
  const selectedId = dom.savedApis.value;
  if (selectedId === "") return;
  const apis = loadAllApis();
  const api = apis[findSavedApiIndex(selectedId, apis)];
  if (api) {
    applyConfig(api);
    saveConfig(api);
    showStatus(`已切换: ${api.name || api.endpoint}`, "info");
    updateApiQuickState();
  }
});

dom.saveConfig.addEventListener("click", async () => {
  const name = await askPrompt("给这个配置起个名字（如：huanapi / GrsAI）：", "");
  if (name === null) return;
  const cfg = currentApiConfig(name || "未命名");
  const apis = loadAllApis();
  const selectedId = dom.savedApis.value;
  const active = loadConfig();
  if (!selectedId && active.id && active.endpoint !== cfg.endpoint) cfg.id = makeApiId();
  const selectedIdx = findSavedApiIndex(selectedId, apis);
  const existIdx = selectedIdx >= 0 ? selectedIdx : apis.findIndex(a => a.name === cfg.name);
  if (existIdx >= 0) {
    cfg.id = apis[existIdx].id;
    apis[existIdx] = cfg;
  }
  else apis.push(cfg);
  saveAllApis(apis);
  saveConfig(cfg);
  renderSavedApis();
  dom.savedApis.value = String(findSavedApiIndex(cfg.id, loadAllApis()));
  showStatus(`已保存: ${cfg.name} ✅`, "success");
  keepApiConfigVisible();
  updateApiQuickState();
});

dom.setDefaultApi?.addEventListener("click", () => {
  let apis = loadAllApis();
  let cfg = apis[findSavedApiIndex(dom.savedApis.value, apis)];
  if (!cfg) {
    cfg = currentApiConfig(readableEndpoint(dom.apiEndpoint.value.trim()) || apiProviderLabel(dom.apiProvider?.value || "custom"));
    const active = loadConfig();
    if (active.id && active.endpoint !== cfg.endpoint) cfg.id = makeApiId();
    if (!cfg.endpoint) {
      showStatus("请先填写 API 地址，再设为默认", "error");
      return;
    }
    const existingIdx = apis.findIndex(api => api.endpoint === cfg.endpoint && api.apiKey === cfg.apiKey);
    if (existingIdx >= 0) {
      cfg.id = apis[existingIdx].id;
      apis[existingIdx] = cfg;
    } else {
      apis.push(cfg);
    }
    saveAllApis(apis);
  }
  saveDefaultApiId(cfg.id);
  saveConfig(cfg);
  applyConfig(cfg);
  renderSavedApis();
  dom.savedApis.value = String(findSavedApiIndex(cfg.id, loadAllApis()));
  showStatus(`已设为默认 API: ${cfg.name}`, "success");
  keepApiConfigVisible();
});

dom.deleteSavedApi.addEventListener("click", async () => {
  const selectedId = dom.savedApis.value;
  if (!selectedId) return;
  const apis = loadAllApis();
  const idx = findSavedApiIndex(selectedId, apis);
  if (idx < 0) return;
  const deleted = apis[idx];
  const name = deleted?.name;
  if (!(await askConfirm(`删除配置「${name}」?`))) return;
  apis.splice(idx, 1);
  saveAllApis(apis);
  if (loadDefaultApiId() === deleted?.id) saveDefaultApiId("");
  dom.savedApis.value = "";
  renderSavedApis();
  const active = loadConfig();
  const deletingActive = deleted && (
    active.id === deleted.id ||
    active.name === deleted.name ||
    (active.endpoint && active.endpoint === deleted.endpoint && active.apiKey === deleted.apiKey)
  );
  if (deletingActive) {
    clearConfig();
    applyApiProvider("custom", { forceEndpoint: true });
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
if (config?.id) {
  const idx = findSavedApiIndex(config.id, loadAllApis());
  if (idx >= 0) dom.savedApis.value = String(idx);
}
dom.configSection.open = false;
updateApiQuickState();

dom.apiProvider?.addEventListener("change", () => {
  const provider = dom.apiProvider.value;
  applyApiProvider(provider, { forceEndpoint: true });
  if (provider === "grsai") {
    loadGrsaiModels();
    dom.model.placeholder = "点击输入或检测选择模型";
  } else if (provider === "official") {
    dom.model.placeholder = "gpt-image-2";
  }
  if (dom.apiEndpoint.value.trim() || dom.apiKey.value.trim()) {
    saveConfig(currentApiConfig());
  }
  updateApiQuickState();
});

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
const DESKTOP_PROXY_DEFAULT_MODE = "http7890";
const DESKTOP_PROXY_PRESETS = {
  http7890: "http://127.0.0.1:7890",
  socks10808: "socks5://127.0.0.1:10808",
  direct: "",
};

function loadSettings() {
  try {
    return {
      historyEnabled: true,
      historyLimit: 100,
      retryCount: 3,
      desktopProxyMode: DESKTOP_PROXY_DEFAULT_MODE,
      desktopProxyCustomUrl: "",
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
    };
  } catch {
    return { historyEnabled: true, historyLimit: 100, retryCount: 3, desktopProxyMode: DESKTOP_PROXY_DEFAULT_MODE, desktopProxyCustomUrl: "" };
  }
}

function saveSettings(next = {}) {
  const current = loadSettings();
  const merged = { ...current, ...next };
  merged.historyLimit = Math.min(500, Math.max(20, Number(merged.historyLimit) || 100));
  merged.retryCount = clampRetryCount(merged.retryCount);
  merged.desktopProxyMode = normalizeDesktopProxyMode(merged.desktopProxyMode);
  merged.desktopProxyCustomUrl = String(merged.desktopProxyCustomUrl || "").trim();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  applySettings(merged);
  return merged;
}

function applySettings(settings = loadSettings()) {
  if (dom.historyEnabled) dom.historyEnabled.checked = settings.historyEnabled !== false;
  if (dom.historyLimit) dom.historyLimit.value = String(settings.historyLimit || 100);
  if (dom.retryCount) dom.retryCount.value = String(clampRetryCount(settings.retryCount));
  if (dom.desktopProxyMode) dom.desktopProxyMode.value = normalizeDesktopProxyMode(settings.desktopProxyMode);
  if (dom.desktopProxyCustomUrl) dom.desktopProxyCustomUrl.value = String(settings.desktopProxyCustomUrl || "");
  updateDesktopProxyUi(settings);
  if (dom.failedRetryCount && !dom.failedRetryCount.dataset.edited) {
    dom.failedRetryCount.value = String(clampRetryCount(settings.retryCount));
  }
}

function normalizeDesktopProxyMode(mode) {
  return ["http7890", "socks10808", "direct", "custom"].includes(mode)
    ? mode
    : DESKTOP_PROXY_DEFAULT_MODE;
}

function parseDesktopProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return { valid: false, error: cleanText("desktopProxyInvalid") };
  try {
    const url = new URL(raw);
    const protocol = url.protocol.replace(":", "").toLowerCase();
    if (!["http", "https", "socks5"].includes(protocol)) {
      return { valid: false, error: cleanText("desktopProxyInvalid") };
    }
    if (!url.hostname || !url.port || url.username || url.password || !["", "/"].includes(url.pathname)) {
      return { valid: false, error: cleanText("desktopProxyInvalid") };
    }
    return { valid: true, url: `${protocol}://${url.hostname}:${url.port}` };
  } catch {
    return { valid: false, error: cleanText("desktopProxyInvalid") };
  }
}

function resolveDesktopProxyConfig(settings = loadSettings()) {
  const mode = normalizeDesktopProxyMode(settings.desktopProxyMode);
  if (mode === "direct") {
    return { valid: true, mode, proxyMode: "direct", proxyUrl: "", label: cleanText("desktopProxyDirect"), target: "DIRECT" };
  }
  if (mode === "custom") {
    const parsed = parseDesktopProxyUrl(settings.desktopProxyCustomUrl);
    if (!parsed.valid) return { valid: false, mode, proxyMode: "custom", proxyUrl: "", error: parsed.error };
    return { valid: true, mode, proxyMode: "custom", proxyUrl: parsed.url, label: cleanText("desktopProxyCustom"), target: parsed.url };
  }
  const proxyUrl = DESKTOP_PROXY_PRESETS[mode] || DESKTOP_PROXY_PRESETS[DESKTOP_PROXY_DEFAULT_MODE];
  return {
    valid: true,
    mode,
    proxyMode: mode,
    proxyUrl,
    label: cleanText(mode === "socks10808" ? "desktopProxySocks" : "desktopProxyHttp"),
    target: proxyUrl,
  };
}

function getDesktopProxyPayload(options = {}) {
  const config = resolveDesktopProxyConfig(loadSettings());
  if (!config.valid && options.validate) {
    setDesktopProxyStatus(config.error, "error");
    throw new Error(config.error);
  }
  return {
    proxyMode: config.proxyMode,
    proxyUrl: config.proxyUrl,
  };
}

function withDesktopProxyPayload(payload = {}, options = {}) {
  return { ...payload, ...getDesktopProxyPayload({ validate: options.validate !== false }) };
}

function setDesktopProxyStatus(message, type = "info", custom = true) {
  if (!dom.desktopProxyStatus) return;
  dom.desktopProxyStatus.textContent = message;
  dom.desktopProxyStatus.dataset.state = type;
  dom.desktopProxyStatus.dataset.customStatus = custom ? "true" : "";
}

function updateDesktopProxyUi(settings = loadSettings()) {
  const mode = normalizeDesktopProxyMode(settings.desktopProxyMode);
  if (dom.desktopProxyCustomUrl) {
    dom.desktopProxyCustomUrl.disabled = mode !== "custom";
    dom.desktopProxyCustomUrl.placeholder = mode === "custom"
      ? "http://127.0.0.1:7890 或 socks5://127.0.0.1:10808"
      : DESKTOP_PROXY_PRESETS[mode] || "";
  }
  if (dom.desktopProxyStatus && !dom.desktopProxyStatus.dataset.customStatus) {
    dom.desktopProxyStatus.textContent = cleanText("desktopProxyHint");
  }
}

async function testDesktopProxy() {
  if (!nativeDownload.available()) {
    setDesktopProxyStatus(cleanText("desktopProxyBrowserOnly"), "info");
    showStatus(cleanText("desktopProxyBrowserOnly"), "info");
    return;
  }
  const config = resolveDesktopProxyConfig(loadSettings());
  if (!config.valid) {
    setDesktopProxyStatus(config.error, "error");
    showStatus(config.error, "error");
    return;
  }
  setDesktopProxyStatus(cleanText("desktopProxyTesting"), "info");
  try {
    const result = await nativeDownload.nativeFetchPayload({
      url: RELEASE_API_URL,
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
    });
    const status = Number(result?.status || 0);
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status || "?"}`);
    const message = interpolate(cleanText("desktopProxyOk"), { mode: config.label, target: config.target });
    setDesktopProxyStatus(message, "success");
    showStatus(message, "success");
  } catch (err) {
    const message = interpolate(cleanText("desktopProxyFailed"), { reason: err.message || err });
    setDesktopProxyStatus(message, "error");
    showStatus(message, "error");
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

// 已确认根因：Windows 端 webview_windows 0.4.0 转发鼠标滚轮事件时不带光标坐标信息
// （上游 jnschulze/flutter-webview-windows#313 已修复，但从 2024-02 的 0.4.0 之后再没发布过
// 新版本到 pub.dev），导致 Chromium 无法正确判断"光标下该滚动哪个嵌套容器"，滚轮事件很可能
// 被派发到最外层 document/body——而弹窗打开时 body 被设成 overflow:hidden（见 openModal），
// 于是表现为"整个界面完全没反应"。用一个 document 级委托监听器（在 initManualWheelScrollFix
// 里注册，需要等 nativeDownload 初始化完才能判断平台，所以放在文件末尾启动流程里调用），在
// 事件到达时手动找到光标下最近的可滚动祖先并直接改 scrollTop，绕开原生嵌套滚动派发；用委托
// 而不是给每个滚动容器单独绑定，是因为像历史记录卡片里的滚动区域是运行时动态生成的，没法在
// 启动时枚举完。只在确认受影响的原生 Windows exe 环境下启用，浏览器/PWA 端原生嵌套滚动本来
// 就正常，不需要（也不应该）用 JS 覆盖，避免影响原生的平滑/惯性滚动手感。
function findScrollableAncestor(el) {
  let node = el;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node.nodeType === 1) {
      if (canScrollVertically(node)) return node;
    }
    node = node.parentElement;
  }
  return null;
}

function resolveManualWheelScrollTarget(event) {
  const overlay = getTopVisibleOverlay();
  const targetScroller = findScrollableAncestor(resolveWheelEventStartElement(event));
  if (!overlay) return targetScroller;
  if (targetScroller && overlay.contains(targetScroller)) return targetScroller;
  const overlayScroller = getOverlayPrimaryScroller(overlay);
  if (overlayScroller) return overlayScroller;
  if (targetScroller && !overlay.contains(targetScroller)) return null;
  return targetScroller;
}

function initManualWheelScrollFix() {
  if (!isNativeWindowsWebview()) return;
  document.addEventListener("wheel", e => {
    if (e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    const overlay = getTopVisibleOverlay();
    const target = resolveManualWheelScrollTarget(e);
    if (!target && !overlay) return;
    if (target && scrollElementByWheelDelta(target, getWheelDeltaY(e, target))) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!overlay) return;
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false, capture: true });
}

function openModal(modal) {
  modal?.classList.remove("hidden");
  updateBodyScrollLock();
}

function closeModal(modal) {
  modal?.classList.add("hidden");
  updateBodyScrollLock();
}

// ─── 自定义确认/输入弹窗 ─────────────────────────────────────
// 部分 WebView 环境（安卓 WebView 未接管 onJsConfirm/onJsPrompt 时默认静默返回 false/null，
// Windows WebView2 则可能弹出脱离页面样式的原生对话框并阻塞渲染进程）不能可靠支持原生
// confirm()/prompt()，因此用页面内弹窗统一替代，保证全端行为一致。
function openAskDialog({ message, kind = "confirm", defaultValue = "" }) {
  return new Promise(resolve => {
    const isPrompt = kind === "prompt";
    const overlay = document.createElement("div");
    overlay.className = "modal ask-dialog-overlay";
    overlay.innerHTML = `
      <div class="modal-card ask-dialog-card" role="alertdialog" aria-modal="true">
        <p class="ask-dialog-message"></p>
        ${isPrompt ? '<input type="text" class="ask-dialog-input">' : ""}
        <div class="ask-dialog-actions">
          <button type="button" class="btn btn-sm ask-dialog-cancel">取消</button>
          <button type="button" class="btn btn-sm btn-primary ask-dialog-ok">确定</button>
        </div>
      </div>`;
    overlay.querySelector(".ask-dialog-message").textContent = message;
    const input = overlay.querySelector(".ask-dialog-input");
    if (input) input.value = defaultValue || "";

    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      updateBodyScrollLock();
      resolve(value);
    };
    const onKeydown = e => {
      if (e.key === "Escape") { e.preventDefault(); finish(isPrompt ? null : false); }
      else if (e.key === "Enter") { e.preventDefault(); finish(isPrompt ? input.value : true); }
    };
    overlay.querySelector(".ask-dialog-cancel").addEventListener("click", () => finish(isPrompt ? null : false));
    overlay.querySelector(".ask-dialog-ok").addEventListener("click", () => finish(isPrompt ? input.value : true));
    overlay.addEventListener("click", e => { if (e.target === overlay) finish(isPrompt ? null : false); });
    document.addEventListener("keydown", onKeydown, true);

    document.body.appendChild(overlay);
    updateBodyScrollLock();
    (input || overlay.querySelector(".ask-dialog-ok"))?.focus();
    input?.select();
  });
}

function askConfirm(message) {
  return openAskDialog({ message, kind: "confirm" });
}

function askPrompt(message, defaultValue = "") {
  return openAskDialog({ message, kind: "prompt", defaultValue });
}

dom.settingsBtn?.addEventListener("click", () => openModal(dom.settingsModal));
dom.closeSettings?.addEventListener("click", () => closeModal(dom.settingsModal));
dom.settingsModal?.addEventListener("click", e => { if (e.target === dom.settingsModal) closeModal(dom.settingsModal); });
dom.historyEnabled?.addEventListener("change", () => saveSettings({ historyEnabled: dom.historyEnabled.checked }));
dom.historyLimit?.addEventListener("change", () => saveSettings({ historyLimit: dom.historyLimit.value }));
dom.retryCount?.addEventListener("change", () => saveSettings({ retryCount: dom.retryCount.value }));
dom.desktopProxyMode?.addEventListener("change", () => {
  dom.desktopProxyStatus && (dom.desktopProxyStatus.dataset.customStatus = "");
  saveSettings({ desktopProxyMode: dom.desktopProxyMode.value });
});
dom.desktopProxyCustomUrl?.addEventListener("change", () => {
  dom.desktopProxyStatus && (dom.desktopProxyStatus.dataset.customStatus = "");
  saveSettings({ desktopProxyCustomUrl: dom.desktopProxyCustomUrl.value });
});
dom.testDesktopProxy?.addEventListener("click", () => void testDesktopProxy());
dom.failedRetryCount?.addEventListener("input", () => { dom.failedRetryCount.dataset.edited = "true"; });
dom.failedRetryCount?.addEventListener("change", getFailedRetryCount);
dom.retryFailedAll?.addEventListener("click", retryAllFailedResults);
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  closeModal(dom.settingsModal);
  closeModal(dom.historyModal);
});
applySettings();

function normalizeVersion(value) {
  return String(value || "0.0.0")
    .trim()
    .replace(/^v/i, "")
    .split(/[+-]/)[0]
    .replace(/[^\d.].*$/, "") || "0.0.0";
}

function compareVersions(a, b) {
  const pa = normalizeVersion(a).split(".").map(part => Number(part) || 0);
  const pb = normalizeVersion(b).split(".").map(part => Number(part) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

function getRuntimePlatform() {
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/windows/i.test(ua)) return "windows";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/macintosh|mac os x/i.test(ua)) return "macos";
  return "web";
}

// 是否运行在打包后的 Windows exe（webview_windows 离屏渲染）里，而不是纯浏览器/PWA。
// 这个判定被多个"仅原生 Windows exe 才有"的已知插件缺陷复用（拖放、滚轮嵌套滚动等）。
function isNativeWindowsWebview() {
  return nativeDownload.available() && getRuntimePlatform() === "windows";
}

// webview_windows 用离屏渲染（Windows.Graphics.Capture）承载页面内容，HTML5 拖放依赖的 OS 级
// drop target 注册在这种模式下不生效（上游 flutter-webview-windows#9，长期未修）；纯浏览器/PWA
// 端是真实浏览器，拖放完全正常，所以只在原生 Windows exe 里才判定为失效。
function isDragDropUnsupported() {
  return isNativeWindowsWebview();
}

function selectUpdateAsset(release, platform = getRuntimePlatform()) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  if (!assets.length) return null;
  const byName = matcher => assets.find(asset => matcher.test(String(asset.name || "")));
  const candidates = {
    android: [/android.*\.apk$/i, /\.apk$/i],
    windows: [/windows.*\.exe$/i, /setup.*\.exe$/i, /\.exe$/i],
    macos: [/macos.*\.zip$/i, /darwin.*\.zip$/i],
    ios: [/ios.*\.zip$/i],
  }[platform] || [/setup.*\.exe$/i, /\.apk$/i, /\.zip$/i];
  for (const matcher of candidates) {
    const asset = byName(matcher);
    if (asset?.browser_download_url) return asset;
  }
  return assets.find(asset => asset?.browser_download_url) || null;
}

function setUpdateStatus(message, type = "info", custom = true) {
  if (!dom.updateStatus) return;
  dom.updateStatus.textContent = message;
  dom.updateStatus.dataset.customStatus = custom ? "true" : "";
  dom.updateStatus.dataset.state = type;
}

function updateInstallButtonState(busy = false) {
  if (dom.checkUpdates) dom.checkUpdates.disabled = !!busy;
  const knownNoUpdate = latestUpdateInfo && latestUpdateInfo.isNewer === false;
  if (dom.installUpdate) dom.installUpdate.disabled = !!busy || knownNoUpdate;
}

function setUpdateButtonsBusy(busy) {
  updateInstallButtonState(!!busy);
}

function updateReleaseDetails(info) {
  if (dom.updateAssetLabel) {
    const asset = info?.release ? selectUpdateAsset(info.release) : null;
    dom.updateAssetLabel.textContent = asset?.name || cleanText("notChecked");
  }
  if (dom.updateNotes) {
    const notes = String(info?.release?.body || "").trim();
    dom.updateNotes.value = notes;
    dom.updateNotes.placeholder = cleanText("releaseNotesPlaceholder");
  }
}

function setLatestUpdateInfo(info) {
  latestUpdateInfo = info || null;
  latestUpdateRelease = latestUpdateInfo?.release || null;
  updateReleaseDetails(latestUpdateInfo);
  updateInstallButtonState(false);
}

async function fetchLatestReleaseInfo() {
  const response = await smartFetch(RELEASE_API_URL, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function checkForUpdates(options = {}) {
  const silent = !!options.silent;
  if (!silent) {
    setUpdateButtonsBusy(true);
    setUpdateStatus(cleanText("checkingUpdates"));
  }
  try {
    const release = await fetchLatestReleaseInfo();
    const latest = normalizeVersion(release.tag_name || release.name || "");
    if (dom.currentVersionLabel) dom.currentVersionLabel.textContent = `v${APP_VERSION}`;
    if (dom.latestVersionLabel) dom.latestVersionLabel.textContent = latest ? `v${latest}` : cleanText("notChecked");
    const isNewer = compareVersions(latest, APP_VERSION) > 0;
    const info = { release, latest, isNewer };
    setLatestUpdateInfo(info);
    const message = isNewer
      ? interpolate(cleanText("updateAvailable"), { version: `v${latest}` })
      : cleanText("noUpdate");
    setUpdateStatus(message, isNewer ? "success" : "info");
    if (!silent) showStatus(message, isNewer ? "success" : "info");
    return info;
  } catch (err) {
    const message = `${cleanText("updateCheckFailed")}: ${err.message || err}`;
    setUpdateStatus(message, "error");
    if (!silent) showStatus(message, "error");
    throw err;
  } finally {
    if (!silent) setUpdateButtonsBusy(false);
  }
}

async function downloadLatestUpdate(install = false) {
  setUpdateButtonsBusy(true);
  setUpdateStatus(cleanText("downloadingUpdate"));
  try {
    const info = latestUpdateRelease
      ? (latestUpdateInfo || { release: latestUpdateRelease, latest: normalizeVersion(latestUpdateRelease.tag_name || latestUpdateRelease.name || ""), isNewer: compareVersions(latestUpdateRelease.tag_name || latestUpdateRelease.name || "", APP_VERSION) > 0 })
      : await checkForUpdates({ silent: true });
    if (!info.isNewer) {
      setUpdateStatus(cleanText("noUpdate"), "info");
      showStatus(cleanText("noUpdate"), "info");
      return { skipped: true, reason: "up-to-date", latest: info.latest };
    }

    // 手机端（安卓）不做应用内下载/覆盖安装：只跳转到 GitHub 发布页，用户在浏览器/系统里自行下载安装。
    // 桌面端（Windows/macOS）继续走原生下载 + 覆盖安装。
    if (getRuntimePlatform() === "android") {
      const releaseUrl = info.release?.html_url || `https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v${info.latest}`;
      await openExternalUrl(releaseUrl);
      setUpdateStatus(cleanText("updateOpenGithubMobile"), "info");
      showStatus(cleanText("updateOpenGithubMobile"), "info");
      return { opened: true, url: releaseUrl };
    }

    const asset = selectUpdateAsset(info.release);
    if (!asset) throw new Error(cleanText("noUpdateAsset"));
    const url = asset.browser_download_url;
    const fileName = asset.name || `AI-Image-Generator-${info.latest || Date.now()}.zip`;

    if (nativeDownload.available() && typeof nativeDownload.downloadUpdate === "function") {
      const result = await nativeDownload.downloadUpdate(url, fileName, install, getRuntimePlatform());
      const path = result?.path || fileName;
      if (install && result?.installerStarted) {
        setUpdateStatus(cleanText("updateInstallStarted"), "success");
        showStatus(cleanText("updateInstallStarted"), "success");
      } else {
        const message = interpolate(cleanText("updateDownloaded"), { path });
        setUpdateStatus(message, "success");
        showStatus(message, "success");
      }
      return result;
    }

    await openExternalUrl(url);
    setUpdateStatus(cleanText("updateOpenRelease"), "info");
    showStatus(cleanText("updateOpenRelease"), "info");
    return { opened: true, url };
  } catch (err) {
    const message = `${install ? cleanText("installUpdate") : cleanText("downloadUpdate")}: ${err.message || err}`;
    setUpdateStatus(message, "error");
    showStatus(message, "error");
    throw err;
  } finally {
    setUpdateButtonsBusy(false);
  }
}

if (dom.currentVersionLabel) dom.currentVersionLabel.textContent = `v${APP_VERSION}`;
if (dom.latestVersionLabel) dom.latestVersionLabel.textContent = cleanText("notChecked");
dom.checkUpdates?.addEventListener("click", () => void checkForUpdates());
dom.installUpdate?.addEventListener("click", () => void downloadLatestUpdate(true));
window.AiGenUpdate = { APP_VERSION, checkForUpdates, downloadLatestUpdate, compareVersions, selectUpdateAsset, getRuntimePlatform };
window.AiGenProxy = { resolveDesktopProxyConfig, getDesktopProxyPayload, withDesktopProxyPayload, parseDesktopProxyUrl };

// ─── 已知模型价格（跨平台通用） ─────────────────────────────
const GRSAI_GPT_IMAGE_MODELS = Object.freeze([
  "gpt-image-2",
  "gpt-image-2-vip",
]);
const GRSAI_NANO_BANANA_MODELS = Object.freeze([
  "nano-banana",
  "nano-banana-fast",
  "nano-banana-2",
  "nano-banana-2-cl",
  "nano-banana-2-2k-cl",
  "nano-banana-2-4k-cl",
  "nano-banana-pro",
  "nano-banana-pro-vt",
  "nano-banana-pro-cl",
  "nano-banana-pro-vip",
  "nano-banana-pro-4k-vip",
]);
const GRSAI_OFFICIAL_MODELS = Object.freeze([
  ...GRSAI_GPT_IMAGE_MODELS,
  ...GRSAI_NANO_BANANA_MODELS,
]);
const GRSAI_POLL_INTERVAL_MS = 2000;
const GRSAI_MAX_POLL_COUNT = 180;

const KNOWN_PRICES = {
  "gpt-image-2": "¥0.03/张", "gpt-image-2-vip": "¥0.065/张",
  "nano-banana-fast": "¥0.022~0.044/次", "nano-banana": "¥0.07~0.14/次",
  "nano-banana-2": "¥0.06~0.12/次", "nano-banana-2-cl": "¥0.08~0.16/次",
  "nano-banana-2-4k-cl": "¥0.15~0.3/次",
  "nano-banana-pro": "¥0.09~0.18/次", "nano-banana-pro-vt": "¥0.09~0.18/次",
  "nano-banana-pro-cl": "¥0.3~0.6/次", "nano-banana-pro-vip": "¥0.5~1/次",
  "nano-banana-pro-4k-vip": "¥0.8~1.6/次",
  "gpt-image-1": "¥0.02/张",
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

function setModelChoices(models = [], options = {}) {
  const ids = [...new Set(models.map(item => {
    if (typeof item === "string") return item.trim();
    return String(item?.id || item?.value || "").trim();
  }).filter(Boolean))];
  if (!dom.modelChoices) return ids;
  dom.modelChoices.innerHTML = "";
  if (!ids.length) {
    dom.model?.classList.remove("has-model-choices");
    return ids;
  }
  dom.modelChoices.appendChild(new Option(cleanText("modelChoicesPlaceholder"), ""));
  ids.slice(0, options.limit || 80).forEach(id => {
    dom.modelChoices.appendChild(new Option(id + priceLabel(id), id));
  });
  dom.modelChoices.value = "";
  dom.model?.classList.add("has-model-choices");
  return ids;
}

// ─── 内置模型列表（兜底用）─────────────────────────────────
function loadFallbackModels() {
  const ids = Object.keys(KNOWN_PRICES).filter(k => !/nano-banana|gpt-image-2-vip/.test(k));
  setModelChoices(ids);
  dom.model.value = "";
  dom.model.placeholder = `已加载 ${ids.length} 个模型，点击选择`;
  updateApiQuickState();
}

function loadGrsaiModels() {
  const ids = GRSAI_OFFICIAL_MODELS;
  setModelChoices(ids);
  dom.model.value = "";
  dom.model.placeholder = `已加载 ${ids.length} 个 GrsAI 模型，点击选择`;
  updateApiQuickState();
}

// 模型变更时提示价格 + 自动更新已保存配置
dom.model.addEventListener("change", () => {
  const m = dom.model.value.trim();
  if (KNOWN_PRICES[m]) showStatus(`已选: ${m} · ${KNOWN_PRICES[m]}`, "info");
  const selectedId = dom.savedApis.value;
  if (selectedId) {
    const apis = loadAllApis();
    const api = apis[findSavedApiIndex(selectedId, apis)];
    if (api) {
      api.model = m;
      saveAllApis(apis);
      renderSavedApis();
      dom.savedApis.value = selectedId;
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
if (!config.endpoint) dom.apiEndpoint.placeholder = GRSAI_API_ENDPOINT;
if (!config.model)   dom.model.placeholder = "gpt-image-2";

// 端点变化时自动检测平台并加载对应模型
dom.apiEndpoint.addEventListener("change", () => {
  const ep = dom.apiEndpoint.value.trim();
  const provider = dom.apiProvider?.value || inferApiProvider(ep);
  if (provider !== "custom") {
    applyApiProvider(provider, { forceEndpoint: false });
  }
  if (provider === "grsai") {
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

// 头部导出按钮
$("#exportBtn")?.addEventListener("click", () => void handleExportAction());

// GrsAI 推荐地址一键填入
$("#useGrsaiEndpoint")?.addEventListener("click", () => {
  if (dom.apiEndpoint) {
    applyApiProvider("grsai", { forceEndpoint: true });
    dom.apiEndpoint.value = GRSAI_API_ENDPOINT;
    dom.apiEndpoint.focus();
    saveConfig(currentApiConfig());
    updateApiQuickState();
  }
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

function switchMode(mode) {
  currentMode = mode;
  if (abortController) stopCurrentGeneration();
  $$(".mode-tab", dom.modeTabs).forEach(t => {
    t.classList.toggle("active", t.dataset.mode === mode);
  });

  const isComic = mode === "comic";
  const isCaption = mode === "caption";
  dom.comicSection.classList.toggle("hidden", !isComic);
  dom.captionSection.classList.toggle("hidden", !isCaption);
  dom.nImagesField.classList.toggle("hidden", isComic || isCaption);
  dom.referenceField.classList.toggle("hidden", isCaption);
  dom.saveComicFolder.classList.toggle("hidden", !(isComic || isCaption));
  dom.progressWrap.classList.toggle("hidden", true);

  const label = $("#globalPromptField .field-label-text");
  if (label) label.textContent = tr(isComic ? "全局提示词（注入所有分镜）" : isCaption ? "全局提示词（注入所有图片）" : "提示词");

  setButtonText(dom.generateBtn, "spark", isComic ? "generateAll" : isCaption ? "generateAllCaptions" : "generateImage");

  if (isComic) {
    dom.promptHint.textContent = tr("全局提示词将拼接在每个分镜提示词前面");
    if (dom.panelTbody.children.length === 0) addPanelRow();
  } else if (isCaption) {
    dom.promptHint.textContent = tr("全局提示词将拼接在每张图片的气泡文字前面");
  } else {
    dom.promptHint.textContent = "";
  }

  applyCleanLanguage();
  clearStatus();
}

function refreshLocalizedUiState() {
  const isComic = currentMode === "comic";
  const isCaption = currentMode === "caption";
  const label = $("#globalPromptField .field-label-text");
  if (label) label.textContent = tr(isComic ? "全局提示词（注入所有分镜）" : isCaption ? "全局提示词（注入所有图片）" : "提示词");
  if (dom.promptHint) dom.promptHint.textContent = isComic ? tr("全局提示词将拼接在每个分镜提示词前面") : isCaption ? tr("全局提示词将拼接在每张图片的气泡文字前面") : "";
  setButtonText(dom.generateBtn, "spark", isComic ? "generateAll" : isCaption ? "generateAllCaptions" : "generateImage");
  setButtonText(dom.detectModels, "search", "detect");
  setButtonText(dom.downloadZip, "zip", "downloadZip");
  setButtonText(dom.saveComicFolder, "folder", "saveToFolder");
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

const SAVED_SIZES_KEY = "ai_image_gen_saved_sizes";

function parseSizeValue(size) {
  const match = String(size || "").match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!match) return null;
  const width = Math.min(4096, Math.max(64, Number(match[1]) || 1024));
  const height = Math.min(4096, Math.max(64, Number(match[2]) || 1024));
  return { width, height, value: `${width}x${height}` };
}

function loadSavedSizes() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_SIZES_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.map(item => {
          const parsed = parseSizeValue(item.value);
          return parsed ? { name: item.name || parsed.value.replace("x", "×"), value: parsed.value } : null;
        }).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function saveSavedSizes(list) {
  localStorage.setItem(SAVED_SIZES_KEY, JSON.stringify(list));
}

function renderSavedSizes() {
  if (!dom.savedSizes) return;
  const selected = dom.savedSizes.value;
  dom.savedSizes.innerHTML = `<option value="">${cleanText("savedSizes")}</option>`;
  loadSavedSizes().forEach(size => {
    const opt = document.createElement("option");
    opt.value = size.value;
    opt.textContent = `${size.name} · ${size.value.replace("x", "×")}`;
    dom.savedSizes.appendChild(opt);
  });
  if (selected && dom.savedSizes.querySelector(`option[value="${selected}"]`)) {
    dom.savedSizes.value = selected;
  }
  customSelects.savedSizes?.syncLabel();
}

function applySizeValue(size) {
  const parsed = parseSizeValue(size);
  if (!parsed) return false;
  const builtin = document.querySelector(`input[name="size"][value="${parsed.value}"]`);
  if (builtin) {
    builtin.checked = true;
  } else {
    const custom = document.querySelector('input[name="size"][value="custom"]');
    if (custom) custom.checked = true;
    dom.customWidth.value = String(parsed.width);
    dom.customHeight.value = String(parsed.height);
  }
  return true;
}

dom.saveSizePreset?.addEventListener("click", async () => {
  const parsed = parseSizeValue(getSelectedSize());
  if (!parsed) {
    showStatus("当前尺寸无效，宽高需要在 64 到 4096 之间", "error");
    return;
  }
  const defaultName = parsed.value.replace("x", "×");
  const name = await askPrompt("给这个常用尺寸起个名字：", defaultName);
  if (name === null) return;
  const sizes = loadSavedSizes();
  const item = { name: (name || defaultName).trim() || defaultName, value: parsed.value };
  const idx = sizes.findIndex(size => size.value === item.value);
  if (idx >= 0) sizes[idx] = item;
  else sizes.push(item);
  saveSavedSizes(sizes.slice(0, 24));
  renderSavedSizes();
  dom.savedSizes.value = item.value;
  showStatus(`已保存常用尺寸: ${item.name}`, "success");
});

dom.savedSizes?.addEventListener("change", () => {
  if (!dom.savedSizes.value) return;
  if (applySizeValue(dom.savedSizes.value)) {
    showStatus(`已应用尺寸: ${dom.savedSizes.value.replace("x", "×")}`, "info");
  }
});

dom.deleteSizePreset?.addEventListener("click", () => {
  const selected = dom.savedSizes?.value;
  if (!selected) return;
  const sizes = loadSavedSizes();
  const next = sizes.filter(size => size.value !== selected);
  saveSavedSizes(next);
  renderSavedSizes();
  showStatus(`已删除常用尺寸: ${selected.replace("x", "×")}`, "info");
});

renderSavedSizes();

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

async function setPanelCount(targetCount) {
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
  if (hasContent && !(await askConfirm(`将删除后面的 ${current - target} 个分镜及其内容，确定继续吗？`))) {
    syncPanelCountInput();
    return;
  }

  rowsToRemove.forEach(row => row.remove());
  renumberPanels();
  showStatus(`已调整为 ${target} 个分镜`, "success");
}

dom.createPanels?.addEventListener("click", async () => {
  const target = getRequestedPanelCount();
  if (dom.panelCount) dom.panelCount.value = String(target);
  await setPanelCount(target);
});
dom.panelCount?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    dom.createPanels?.click();
  }
});

dom.addPanel.addEventListener("click", addPanelRow);
dom.clearPanels.addEventListener("click", async () => {
  if (dom.panelTbody.children.length === 0 && !abortController) return;
  if (await askConfirm("确定清空所有分镜？")) {
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

dom.captionUploadZone.addEventListener("click", e => {
  e.preventDefault();
  e.stopPropagation();
  openFileInputOnce(dom.captionBulkInput);
});
dom.captionUploadZone.addEventListener("dragover", e => { e.preventDefault(); dom.captionUploadZone.classList.add("drag-over"); });
dom.captionUploadZone.addEventListener("dragleave", () => dom.captionUploadZone.classList.remove("drag-over"));
dom.captionUploadZone.addEventListener("drop", e => {
  e.preventDefault();
  dom.captionUploadZone.classList.remove("drag-over");
  addCaptionRowsFromFiles(e.dataTransfer.files);
});
dom.captionBulkInput.addEventListener("change", () => {
  addCaptionRowsFromFiles(dom.captionBulkInput.files);
  dom.captionBulkInput.value = "";
});
dom.clearCaptionRows.addEventListener("click", async () => {
  if (dom.captionTbody.children.length === 0 && !abortController) return;
  if (await askConfirm("确定清空所有嵌字行？")) {
    const wasGenerating = !!abortController;
    stopCurrentGeneration("已取消当前生成并清空嵌字行");
    dom.captionTbody.innerHTML = "";
    captionRowCounter = 0;
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

dom.autoFillPanels.addEventListener("click", async () => {
  const templateType = dom.autoFillTemplate?.value || "panel-output";
  const shouldMatchReferenceCount = /^ref-/.test(templateType) && referenceImages.length > 0;

  if (shouldMatchReferenceCount && dom.panelTbody.children.length < referenceImages.length) {
    const rows = $$(".panel-row", dom.panelTbody);
    const hasContent = rows.some(rowHasPanelContent);
    if (!hasContent || (await askConfirm(`当前有 ${referenceImages.length} 张参考图，是否扩展为 ${referenceImages.length} 个分镜？`))) {
      await setPanelCount(referenceImages.length);
    }
  } else if (dom.panelTbody.children.length === 0 && referenceImages.length > 0) {
    referenceImages.forEach(() => addPanelRow());
  }

  const rows = $$(".panel-row", dom.panelTbody);
  if (rows.length === 0) {
    showStatus("请先添加分镜", "info"); return;
  }

  const hasContent = rows.some(row => row.querySelector("textarea").value.trim());
  if (hasContent && !(await askConfirm("已有分镜提示词，确定用当前模板覆盖吗？"))) return;

  let customTemplate = "";
  if (dom.autoFillTemplate?.value === "custom") {
    customTemplate = (await askPrompt("输入模板：可用 {n} 表示分镜编号，{ref} 表示参考图编号，{caption} 表示字幕内容", "给参考图{ref}加入{caption}的气泡字幕")) || "";
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
//  嵌字表格 CRUD
// ═══════════════════════════════════════════════════════════

const captionRowTemplate = $("#captionRowTemplate");

function applyCaptionRowImage(row, ref) {
  const imgPreview = row.querySelector(".panel-img-preview");
  const imgName = row.querySelector(".panel-img-name");
  const imgClear = row.querySelector(".panel-img-clear");
  row._captionReference = ref;
  imgPreview.style.backgroundImage = `url("${ref.dataUrl}")`;
  imgPreview.classList.remove("hidden");
  imgName.textContent = ref.fileName;
  imgName.title = ref.fileName;
  imgClear.classList.remove("hidden");
}

function addCaptionRow(prefilledRef = null) {
  captionRowCounter++;
  const clone = captionRowTemplate.content.cloneNode(true);
  const row = clone.querySelector(".caption-row");

  row.querySelector(".panel-num").textContent = captionRowCounter;
  row.dataset.captionId = captionRowCounter;

  row.querySelector(".delete-panel").addEventListener("click", () => {
    row.remove();
    renumberCaptionRows();
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
      row._captionReferenceTask = readTask;
      imgBtn.disabled = true;
      imgName.textContent = "读取中";
      try {
        const ref = await readTask;
        if (imgInput.files[0] !== file) return;
        applyCaptionRowImage(row, ref);
        showStatus(`第 ${row.dataset.captionId} 张已绑定图片`, "success");
      } catch (err) {
        row._captionReference = null;
        imgInput.value = "";
        imgName.textContent = "";
        imgName.title = "";
        imgPreview.style.backgroundImage = "";
        imgPreview.classList.add("hidden");
        imgClear.classList.add("hidden");
        showStatus(err.message || "图片读取失败", "error");
      } finally {
        if (row._captionReferenceTask === readTask) row._captionReferenceTask = null;
        imgBtn.disabled = false;
      }
    }
  });
  imgClear.addEventListener("click", () => {
    imgInput.value = "";
    row._captionReference = null;
    row._captionReferenceTask = null;
    imgPreview.style.backgroundImage = "";
    imgPreview.classList.add("hidden");
    imgName.textContent = "";
    imgName.title = "";
    imgClear.classList.add("hidden");
  });

  if (prefilledRef) applyCaptionRowImage(row, prefilledRef);

  dom.captionTbody.appendChild(row);
  return row;
}

async function addCaptionRowsFromFiles(fileList) {
  const imageFiles = [...fileList].filter(file => file.type?.startsWith("image/"));
  if (imageFiles.length === 0) return;

  try {
    const refs = sortReferencesByName(await Promise.all(imageFiles.map(readImageReference)));
    refs.forEach(ref => addCaptionRow(ref));
    showStatus(`已添加 ${refs.length} 张图片（共 ${dom.captionTbody.children.length} 张）`, "success");
  } catch (err) {
    showStatus(err.message || "批量导入图片失败", "error");
  }
}

function renumberCaptionRows() {
  $$(".caption-row", dom.captionTbody).forEach((row, i) => {
    row.querySelector(".panel-num").textContent = i + 1;
    row.dataset.captionId = i + 1;
  });
  captionRowCounter = dom.captionTbody.children.length;
}

function collectCaptionRows() {
  return $$(".caption-row", dom.captionTbody).map(row => ({
    id: row.dataset.captionId,
    captionText: row.querySelector(".caption-text").value.trim(),
    reference: row._captionReference || null,
    referenceTask: row._captionReferenceTask || null,
  }));
}

async function waitForCaptionReferenceTasks(rows) {
  const pending = rows.map(r => r.referenceTask).filter(Boolean);
  if (pending.length === 0) return;
  showStatus(`正在读取 ${pending.length} 张图片…`, "info");
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
  setButtonText(dom.generateBtn, "spark", currentMode === "comic" ? "generateAll" : currentMode === "caption" ? "generateAllCaptions" : "generateImage");
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
function findAdapter(endpoint, provider = dom.apiProvider?.value || inferApiProvider(endpoint)) {
  const url = String(endpoint || "").toLowerCase();
  const selectedProvider = API_PROVIDER_PRESETS[provider] ? provider : "custom";
  if (selectedProvider === "grsai") {
    return adapters.find(a => a.provider === "grsai") || null;
  }
  for (const a of adapters) {
    if (a.provider === "grsai") continue;
    if (a.detect(url)) return a;
  }
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

function parsePixelSize(size) {
  const match = String(size || "").toLowerCase().replace("×", "x").match(/^\s*(\d+)\s*x\s*(\d+)\s*$/);
  if (!match) return { width: 1024, height: 1024, maxSide: 1024, minSide: 1024 };
  const width = Number(match[1]) || 1024;
  const height = Number(match[2]) || 1024;
  return { width, height, maxSide: Math.max(width, height), minSide: Math.min(width, height) };
}

function grsaiEndpointBase(endpoint) {
  const raw = String(endpoint || GRSAI_API_ENDPOINT).trim() || GRSAI_API_ENDPOINT;
  try {
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1\/.*$/i, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/+$/, "").replace(/\/v1\/.*$/i, "").replace(/\/$/, "");
  }
}

function grsaiImageSize(size, model) {
  const normalizedModel = String(model || "").toLowerCase();
  if (/4k/.test(normalizedModel)) return "4K";
  if (/2k/.test(normalizedModel)) return "2K";
  const { maxSide } = parsePixelSize(size);
  if (maxSide >= 2048) return "4K";
  if (maxSide >= 1536) return "2K";
  return "1K";
}

function grsaiResultUrls(data) {
  const urls = [];
  const buckets = [data?.results, data?.data, data?.images].filter(Array.isArray);
  buckets.forEach(items => {
    items.forEach(item => {
      const url = typeof item === "string" ? item : (item?.url || item?.image_url);
      if (url && !urls.includes(url)) urls.push(url);
    });
  });
  if (typeof data?.url === "string" && !urls.includes(data.url)) urls.push(data.url);
  return urls;
}

function grsaiStatusError(data, fallback = "未知") {
  const value = data?.error || data?.message || data?.status || fallback;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); }
  catch { return String(value); }
}

function grsaiReferenceValue(ref) {
  const value = String(ref?.url || ref?.dataUrl || ref || "");
  if (/^data:/i.test(value)) return value.split(",")[1] || value;
  return value;
}

async function grsaiReadJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { return { error: text.slice(0, 300) }; }
}

// ═══════════════════════════════════════════════════════════
//  GrsAI 适配器
// ═══════════════════════════════════════════════════════════

registerAdapter({
  name: "GrsAI",
  provider: "grsai",
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
    const base = grsaiEndpointBase(endpoint);
    const isNano = /nano-banana/i.test(model);

    const body = {
      model, prompt, replyType: "json",
      aspectRatio: isNano ? pixelSizeToRatio(size) : size,
    };
    if (isNano) {
      body.imageSize = grsaiImageSize(size, model);
    }
    if (hasRef && refs.length > 0) {
      body.images = refs.map(grsaiReferenceValue).filter(Boolean);
    }
    console.log(`GrsAI 请求: model=${model} size=${size} hasRef=${hasRef} refs=${refs.length}`);

    const t0 = Date.now();
    let res = await apiFetch(`${base}/v1/api/generate`, apiKey, body, { signal });
    let data = res;
    console.log(`GrsAI /api/generate 响应 (${Date.now() - t0}ms):`, data.status);

    const directUrls = grsaiResultUrls(data);
    if (directUrls.length > 0) {
      return { data: directUrls.map(url => ({ url })) };
    }

    if (data.status === "running") {
      const taskId = data.id;
      if (!taskId) throw new Error("GrsAI 未返回任务 ID");
      for (let i = 0; i < GRSAI_MAX_POLL_COUNT; i++) {
        await sleep(GRSAI_POLL_INTERVAL_MS, signal);
        const pollResp = await smartFetch(`${base}/v1/api/result?id=${taskId}`, {
          headers: { "Authorization": `Bearer ${apiKey}` },
          signal,
        });
        res = await grsaiReadJsonResponse(pollResp);
        if (!pollResp.ok) {
          throw new Error(`轮询失败 HTTP ${pollResp.status}: ${grsaiStatusError(res)}`);
        }
        data = res;
        if (data.progress != null) showStatus(`GrsAI 生成中… ${data.progress}%`, "info");
        if (data.status === "succeeded") { clearStatus(); console.log(`GrsAI 完成 (${Date.now() - t0}ms)`); break; }
        if (data.status === "failed" || data.status === "violation") {
          throw new Error(`GrsAI 生成失败: ${grsaiStatusError(data)}`);
        }
      }
      if (data.status === "running") {
        throw new Error(`GrsAI 生成超时：轮询 ${GRSAI_MAX_POLL_COUNT} 次仍未完成`);
      }
    }

    if (data.status === "violation") {
      throw new Error(`GrsAI 生成失败: ${grsaiStatusError(data, "内容违规")}`);
    }
    if (data.status === "succeeded") {
      const urls = grsaiResultUrls(data);
      if (urls.length) return { data: urls.map(url => ({ url })) };
      throw new Error("GrsAI 返回成功但无图片 URL");
    }
    throw new Error(`GrsAI 生成失败: ${grsaiStatusError(data)}`);
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

      setModelChoices(models.map(m => m.id));
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

        setModelChoices(models.map(m => m.id));
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
  const provider = dom.apiProvider?.value || inferApiProvider(endpoint);
  const adapter  = findAdapter(endpoint, provider);

  console.log(`callImageAPI: provider=${provider} adapter=${adapter?.name || "无(直连)"} model=${model} hasRef=${hasRef} refs=${refs.length} size=${size}`);

  let finalSize = size;
  if (dom.useOrigSize.checked && hasRef) {
    const ref = refs[0];
    if (ref.width && ref.height) finalSize = `${ref.width}x${ref.height}`;
  }

  return retryTransient(async attempt => {
    throwIfAborted(signal);
    if (!adapter) {
      const url = normalizeApiUrl(endpoint, "images/generations");
      if (hasRef) console.warn("⚠ 无适配器匹配 + 有参考图：参考图将被忽略，仅走 generations 端点");
      return apiFetch(url, apiKey, { model, prompt, n, size: finalSize, response_format: "b64_json" }, { signal });
    }
    return adapter.generate(endpoint, apiKey, model, prompt, finalSize, n, hasRef, refs, { signal });
  }, {
    signal,
    maxRetries,
    onRetry: ({ retryIndex, maxRetries }) => {
      showStatus(`${contextLabel} 返回 HTTP 400，正在进行第 ${retryIndex}/${maxRetries} 轮自动重试…`, "info");
    },
  });
}

function isTransientApiError(err) {
  const msg = String(err?.message || err || "");
  return /HTTP\s*400\b/i.test(msg);
}

async function retryTransient(fn, options = {}) {
  const maxRetries = clampRetryCount(options.maxRetries, 3);
  const baseDelay = options.baseDelay ?? 1500;
  const signal = options.signal || null;
  const onRetry = typeof options.onRetry === "function" ? options.onRetry : null;
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
      onRetry?.({ retryIndex: attempt, maxRetries, nextAttempt: attempt + 1, delay, error: err });
      console.warn(`HTTP 400 transient error, retry round ${attempt}/${maxRetries} after ${delay}ms:`, err);
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

  const provider = dom.apiProvider?.value || inferApiProvider(endpoint);
  const adapter = findAdapter(endpoint, provider);
  if (!adapter) {
    loadFallbackModels();
    showStatus("未知平台，已加载通用模型列表", "info");
    return;
  }

  dom.detectModels.disabled = true;
  setIconText(dom.detectModels, "spark", currentLanguage === "en" ? "Detecting" : currentLanguage === "ja" ? "検出中" : currentLanguage === "ko" ? "감지 중" : currentLanguage === "zh-Hant" ? "偵測中" : "检测中");
  showStatus("正在检测模型列表…", "info");

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
  const desktopProxy = getDesktopProxyPayload({ validate: false });
  if (body instanceof FormData) {
    return {
      url,
      method,
      headers,
      bodyType: "formData",
      fields: await formDataToProxyFields(body, signal),
      ...desktopProxy,
    };
  }
  return { url, method, headers, body: body || "", ...desktopProxy };
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
    // 生图请求经常比普通网络请求慢得多（复杂模型、排队、GrsAI 异步轮询等都可能超过 2 分钟），
    // 用比默认更长的超时，避免明明还在正常生成、只是慢一点，就被判定为"调用超时"。
    const result = await nativeDownload.nativeFetchPayload(payload, 5 * 60 * 1000);
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
      const result = await nativeDownload.nativeFetchPayload(payload, 5 * 60 * 1000);
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
      throw new Error("网络请求失败。桌面软件请检查设置里的电脑端网络代理；纯浏览器 HTML 请使用系统/浏览器代理，或运行项目内 api-proxy.js 后在 API 配置里填写 http://127.0.0.1:8787/proxy");
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
        const record = replacePlaceholder(placeholder, i + 1, data, prompt, {
          retryContext: { mode: "single", prompt, size, references, retryCount },
        });
        if (record) placeholder._historyRecordId = record.id;
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
      const newProjectId = `project_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      await saveGenerationProject({
        id: newProjectId,
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
      currentComicHistoryId = newProjectId;
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

async function generateCaptions() {
  if (!validateCommon()) return;

  const globalPrompt = getEffectivePrompt();
  const globalSize   = getSelectedSize();
  let rows           = collectCaptionRows();
  await waitForCaptionReferenceTasks(rows);
  rows               = collectCaptionRows();

  const validRows = rows.filter(r => r.captionText && r.reference);
  if (validRows.length === 0) {
    showStatus("请至少给一张图片上传图片并填写气泡文字", "error"); return;
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

  const total = validRows.length;
  let completed = 0;
  let failed = 0;
  const globalRetryCount = getGlobalRetryCount();
  const projectImages = [];

  updateProgress(0, total, "⏳");

  const rowTasks = validRows.map(row => {
    const fullPrompt = globalPrompt ? `${globalPrompt}\n\n${row.captionText}` : row.captionText;
    const size = (row.reference?.width && row.reference?.height) ? `${row.reference.width}x${row.reference.height}` : globalSize;
    const references = [row.reference];
    const retryCount = globalRetryCount;
    const placeholder = addResultPlaceholder(row.id, fullPrompt, {
      mode: "caption",
      globalPrompt,
      panelPrompt: row.captionText,
      prompt: fullPrompt,
      size,
      references,
      retryCount,
    });
    return { row, fullPrompt, size, references, retryCount, placeholder, globalPrompt };
  });

  let done = 0;
  const tasks = rowTasks.map(({ row, fullPrompt, size, references, retryCount, placeholder }) => async () => {
    if (!isGenerationCurrent(run)) return;
    try {
      const data = await callImageAPI(fullPrompt, size, 1, `图片 ${row.id}`, { references, signal: run.signal, maxRetries: retryCount });
      if (!isGenerationCurrent(run)) return;
      const record = replacePlaceholder(placeholder, row.id, data, fullPrompt, {
        skipHistory: true,
        recordPrompt: row.captionText,
        fullPrompt,
        size,
        retryContext: { references, size, mode: "caption", globalPrompt, panelPrompt: row.captionText, prompt: fullPrompt, fullPrompt, retryCount },
      });
      if (record) projectImages.push({ ...record, prompt: row.captionText, panelPrompt: row.captionText, fullPrompt, retryCount });
      completed++;
    } catch (err) {
      if (err.name !== "AbortError" && isGenerationCurrent(run)) {
        markPlaceholderFailed(placeholder, row.id, err.message, {
          references,
          size,
          mode: "caption",
          globalPrompt,
          panelPrompt: row.captionText,
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
      const newProjectId = `project_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      await saveGenerationProject({
        id: newProjectId,
        type: "caption-project",
        mode: "caption",
        title: `嵌字项目 ${new Date().toLocaleString("zh-CN")}`,
        createdAt: new Date().toISOString(),
        globalPrompt,
        model: dom.model.value.trim(),
        endpoint: dom.apiEndpoint.value.trim(),
        size: globalSize,
        retryCount: globalRetryCount,
        totalPanels: total,
        panels: rowTasks.map(({ row, size, retryCount }) => ({
          panelId: String(row.id),
          panelPrompt: row.captionText,
          prompt: row.captionText,
          size,
          retryCount,
          status: projectImages.some(img => String(img.panelId) === String(row.id)) ? "success" : "failed",
        })),
        images: projectImages.sort((a, b) => Number(a.panelId) - Number(b.panelId)),
      });
      currentComicHistoryId = newProjectId;
    }

    if (failed > 0) {
      showStatus(`完成：${completed} 成功 / ${failed} 失败`, "error");
    } else if (completed > 0) {
      showStatus(`全部 ${completed} 张图片生成完成！`, "success");
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
  let previewReloadSeq = 0;
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
  function setPreviewFromBlob(blob) {
    if (!(blob instanceof Blob) || blob.size <= 0) throw new Error("图片字节为空");
    const previousUrl = card._localImageUrl;
    const nextUrl = URL.createObjectURL(blob);
    card._zipBlob = blob;
    card._localImageUrl = nextUrl;
    if (previousUrl && previousUrl !== nextUrl) {
      setTimeout(() => URL.revokeObjectURL(previousUrl), 1000);
    }
    img.removeAttribute("src");
    img.src = nextUrl;
  }

  async function reloadPreviewFromBytes(force = false) {
    const seq = ++previewReloadSeq;
    reloadAttempted = true;
    reloadBtn.disabled = true;
    media.classList.remove("is-error");
    media.classList.add("is-loading");
    mediaStatusText.textContent = tr("图片重新加载中…");
    try {
      let blob = card._zipBlob;
      if (!blob && !force && card._imageCachePromise) {
        blob = await card._imageCachePromise;
      }
      if (!blob) {
        card._imageCachePromise = imageUrlToBlob(imageUrl);
        blob = await card._imageCachePromise;
      }
      if (seq !== previewReloadSeq || !img.isConnected) return;
      await setPreviewFromBlob(blob);
    } catch (err) {
      if (seq !== previewReloadSeq || !img.isConnected) return;
      console.warn(`分镜 ${panelId} 图片重新加载失败`, err);
      media.classList.remove("is-loading");
      media.classList.add("is-error");
      reloadBtn.disabled = false;
      mediaStatusText.textContent = tr("重载失败，仍无法预览");
    }
  }

  reloadBtn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    void reloadPreviewFromBytes(true);
  });
  img.addEventListener("click", () => {
    if (!media.classList.contains("is-error")) openLightbox(card._localImageUrl || imageUrl);
  });
  mediaStatus.append(mediaStatusText, reloadBtn);
  media.append(img, mediaStatus);
  card.appendChild(media);
  img.src = imageUrl;
  const isProjectContext = options.retryContext?.mode === "comic" || options.retryContext?.mode === "caption";
  const recordPrompt = options.recordPrompt
    ?? (isProjectContext ? getPanelOnlyPrompt(options.retryContext, options.retryContext?.globalPrompt || "") : prompt);
  const fullPrompt = options.fullPrompt || options.retryContext?.fullPrompt || (recordPrompt !== prompt ? prompt : "");

  card._zipImage = {
    url: imageUrl,
    panelId: String(panelId),
    prompt: recordPrompt,
    panelPrompt: options.retryContext?.panelPrompt || (isProjectContext ? recordPrompt : ""),
    fullPrompt,
  };

  // 中转站的生图 URL 存活期很短（实测约 2 小时后服务端删图），页面上 <img> 靠浏览器
  // 缓存还能显示，但导出/下载时重新请求远程 URL 会 404。趁 URL 刚生成还活着，立刻把
  // 字节抓到本地；之后 ZIP 打包、单图下载、灯箱都优先用本地副本。
  releaseCardImageCache(card);
  if (!imageUrl.startsWith("data:")) {
    card._imageCachePromise = imageUrlToBlob(imageUrl)
      .then(blob => {
        if (img.isConnected) setPreviewFromBlob(blob);
        return blob;
      })
      .catch(err => {
        console.warn(`分镜 ${panelId} 图片本地缓存失败，导出时将回退远程下载`, err);
        return null;
      });
  }

  const actions = document.createElement("div");
  actions.className = "result-actions";
  actions.append(
    makeCardActionBtn("download", "download", () => downloadImage(card._zipBlob || card._localImageUrl || imageUrl, panelId)),
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
    panelPrompt: options.retryContext?.panelPrompt || (isProjectContext ? recordPrompt : ""),
    fullPrompt,
    model: dom.model.value.trim(),
    endpoint: dom.apiEndpoint.value.trim(),
    size: options.size || options.retryContext?.size || getSelectedSize(),
    imageUrl,
    originalUrl: item.url || "",
    retryCount: options.retryContext?.retryCount ?? getGlobalRetryCount(),
  };
  generatedImageUrls.push({ url: imageUrl, panelId: String(panelId), prompt, recordId: record.id });
  if (!options.skipHistory && record.mode !== "comic") saveGenerationRecord(record);
  updateFailedRetryTools();
  return record;
}

function releaseCardImageCache(card) {
  if (card._localImageUrl) URL.revokeObjectURL(card._localImageUrl);
  card._localImageUrl = "";
  card._zipBlob = null;
  card._imageCachePromise = null;
}

function markPlaceholderFailed(card, panelId, errMsg, retryContext = {}) {
  const message = String(errMsg || "生成失败");
  setRetryContext(card, panelId, { ...(card._retryContext || {}), ...(retryContext || {}) });
  card.classList.add("is-failed");
  card.dataset.failed = "true";
  card.dataset.status = "failed";
  card.dataset.errorMessage = message;
  delete card._zipImage;
  releaseCardImageCache(card);
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
    // 与批量生成保持同样的并发度；串行会让后面的卡片等前一张生完才开始，
    // 看起来像"只重试了一个"。
    const tasks = cards.map(card => () => {
      if (!card.isConnected || !card.classList.contains("is-failed")) return Promise.resolve(null);
      return retryResultCard(card, false, { retryCountOverride: retryCount, quiet: true });
    });
    const settled = await concurrentLimitSettled(tasks, 20);
    for (const result of settled) {
      if (result.status === "fulfilled") {
        if (result.value === null) continue;
        if (result.value) ok++;
        else failed++;
      } else {
        failed++;
      }
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
  if (context.mode === "comic" || context.mode === "caption") {
    return context.globalPrompt ? `${context.globalPrompt}\n\n${context.panelPrompt || ""}`.trim() : (context.panelPrompt || context.prompt || "");
  }
  return context.prompt || "";
}

async function editRetryContext(context) {
  const next = { ...context };
  if (next.mode === "comic" || next.mode === "caption") {
    const label = next.mode === "caption"
      ? "修改气泡文字内容（全局提示词会自动引用当前页面里的内容）"
      : "修改该分镜提示词（全局提示词会自动引用当前页面里的内容）";
    const panel = await askPrompt(label, next.panelPrompt || next.prompt || "");
    if (panel === null) return null;
    next.globalPrompt = getEffectivePrompt();
    next.panelPrompt = panel.trim();
    next.prompt = composeRetryPrompt(next);
    return next;
  }
  const edited = await askPrompt("修改提示词后重试", next.prompt || "");
  if (edited === null) return null;
  next.prompt = edited.trim();
  return next;
}

function renderRetryLoading(card, panelId, promptText) {
  card.classList.remove("is-failed");
  delete card.dataset.failed;
  delete card.dataset.errorMessage;
  delete card._zipImage;
  releaseCardImageCache(card);
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
    context = await editRetryContext(context);
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
  const isProject = context.mode === "comic" || context.mode === "caption";
  const label = context.mode === "caption" ? "图片" : "分镜";
  setRetryContext(card, panelId, { ...context, prompt: promptText, size, retryCount });
  renderRetryLoading(card, panelId, promptText);
  try {
    const references = Array.isArray(context.references) ? context.references : undefined;
    const data = await callImageAPI(promptText, size, 1, `${label} ${panelId}`, { references, maxRetries: retryCount });
    const record = replacePlaceholder(card, panelId, data, promptText, {
      skipHistory: true, // 重试的历史记录更新自己接管（原地替换旧图），不走默认的“新增一条”逻辑
      recordPrompt: isProject ? getPanelOnlyPrompt(context, context.globalPrompt || "") : promptText,
      fullPrompt: promptText,
      retryContext: { ...context, prompt: promptText, fullPrompt: promptText, size, retryCount },
    });
    if (record) {
      if (isProject) {
        await updateComicHistoryPanel(currentComicHistoryId, panelId, record);
      } else {
        await replaceSingleHistoryRecord(card._historyRecordId, record);
        card._historyRecordId = record.id;
      }
    }
    if (!options.quiet) showStatus(`${label} ${panelId} 重试成功`, "success");
    return true;
  } catch (err) {
    markPlaceholderFailed(card, panelId, err.message || String(err), { ...context, prompt: promptText, size, retryCount });
    if (!options.quiet) showStatus(`${label} ${panelId} 重试失败: ${err.message || err}`, "error");
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

function addPromptCollapseToggle(container, promptEl, text) {
  if (!container || !promptEl || String(text || "").length <= 90) return;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "history-prompt-toggle";
  toggle.textContent = cleanText("expand");
  toggle.addEventListener("click", () => {
    const expanded = promptEl.classList.toggle("expanded");
    toggle.textContent = expanded ? cleanText("collapse") : cleanText("expand");
  });
  container.appendChild(toggle);
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
  return item?.type === "comic-project" || item?.type === "caption-project"
    || (Array.isArray(item?.images) && (item.mode === "comic" || item.mode === "caption"));
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

function clearAllReferenceImages() {
  referenceImages = [];
  renderThumbGrid();
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
    type: project.type || "comic-project",
    mode: project.mode || "comic",
    prompt: project.globalPrompt || "",
    images,
    imageUrl: first?.imageUrl || "",
    originalUrl: first?.originalUrl || "",
  };
  const list = loadHistory();
  list.unshift(record);
  saveHistory(list);
}

// 重试单图模式的某张图片成功后：删掉它原来那条历史记录，用新结果重新入一条
// （而不是留着旧记录不管、平白多出一条重复记录）。
async function replaceSingleHistoryRecord(oldRecordId, newRecord) {
  if (loadSettings().historyEnabled === false) return;
  const record = { ...newRecord, imageUrl: await makeHistoryImageUrl(newRecord.imageUrl) };
  const list = loadHistory();
  const filtered = oldRecordId ? list.filter(item => item.id !== oldRecordId) : list;
  filtered.unshift(record);
  saveHistory(filtered);
}

// 重试漫画分镜里的某一张成功后：原地替换该项目历史记录里对应分镜的图片，
// 不新增记录、不改变项目在历史列表里的位置，旧图彻底不留痕迹。
async function updateComicHistoryPanel(projectId, panelId, record) {
  if (!projectId || loadSettings().historyEnabled === false) return;
  const list = loadHistory();
  const project = list.find(item => item.id === projectId && isHistoryProject(item));
  if (!project || !Array.isArray(project.images)) return;
  const idx = project.images.findIndex(img => String(img.panelId || "") === String(panelId));
  if (idx === -1) return;
  const panelPrompt = getPanelOnlyPrompt(record, project.globalPrompt || "");
  project.images[idx] = {
    ...project.images[idx],
    prompt: panelPrompt,
    panelPrompt,
    fullPrompt: record.fullPrompt || project.images[idx].fullPrompt,
    imageUrl: await makeHistoryImageUrl(record.imageUrl),
    originalUrl: record.originalUrl || record.imageUrl,
    retryCount: record.retryCount ?? project.images[idx].retryCount,
    size: record.size || project.images[idx].size,
  };
  if (idx === 0) {
    project.imageUrl = project.images[0].imageUrl;
    project.originalUrl = project.images[0].originalUrl;
  }
  saveHistory(list);
}

async function makeHistoryImageUrl(imageUrl) {
  if (!imageUrl || imageUrl.startsWith("data:")) return imageUrl;
  try {
    // imageUrlToBlob 在安卓/Windows 壳里走原生请求（裸 fetch 会被 WebView CORS 拦截），
    // 浏览器端才退回 fetch。远程生图 URL 约 2 小时被中转站删除，历史记录必须存本地字节。
    return await blobToDataUrl(await imageUrlToBlob(imageUrl));
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
  const list = loadHistory().filter(item => isHistoryProject(item) || item?.mode !== "comic");
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
    body.className = "history-prompt-text";
    body.textContent = text || cleanText("noPrompt");
    block.append(strong, body);
    addPromptCollapseToggle(block, body, body.textContent);
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
  addPromptCollapseToggle(meta, prompt, longPrompt);
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
      folder: sanitizeFilePart(item.title || (item.mode === "caption" ? "caption-project" : "comic-project"), item.mode === "caption" ? "caption-project" : "comic-project"),
      mode: item.mode || "comic",
      title: item.title || cleanText(item.mode === "caption" ? "captionProject" : "comicProject"),
      createdAt: item.createdAt,
      model: item.model || "",
      globalPrompt: item.globalPrompt || "",
    });
    const filename = `${sanitizeFilePart(item.title || (item.mode === "caption" ? "caption-project" : "comic-project"), item.mode === "caption" ? "caption-project" : "comic-project")}.zip`;
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
  if (item.mode === "caption") {
    switchMode("caption");
    clearAllReferenceImages();
    dom.prompt.value = item.globalPrompt || item.prompt || "";
    dom.captionTbody.innerHTML = "";
    captionRowCounter = 0;

    const sourceRows = Array.isArray(item.panels) && item.panels.length ? item.panels : images;
    sourceRows.forEach((panel, index) => {
      const matchingImage = images.find(img => String(img.panelId || "") === String(panel.panelId || index + 1)) || images[index] || {};
      const rowData = {
        ...matchingImage,
        ...panel,
        panelPrompt: panel.panelPrompt || matchingImage.panelPrompt || "",
        prompt: panel.prompt || matchingImage.prompt || "",
        fullPrompt: panel.fullPrompt || matchingImage.fullPrompt || "",
      };
      const row = addCaptionRow();
      const captionInput = row.querySelector(".caption-text");
      if (captionInput) captionInput.value = getPanelOnlyPrompt(rowData, item.globalPrompt || "");
    });

    if (dom.captionTbody.children.length === 0) addCaptionRow();
    refreshLocalizedUiState();
    return;
  }

  switchMode("comic");
  clearAllReferenceImages();
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
  clearAllReferenceImages();

  if (isHistoryProject(item)) {
    const images = getHistoryImages(item);
    restoreHistoryProjectEditor(item, images);
    dom.resultGrid.innerHTML = "";
    generatedImageUrls = [];
    currentComicHistoryId = item.id || null; // 恢复后重试某个分镜时，原地更新这条历史记录
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
          mode: item.mode || "comic",
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
    showStatus(item.mode === "caption" ? `已恢复嵌字项目：${images.length} 张图片` : `已恢复漫画项目：${images.length} 张图片`, "success");
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
  card._historyRecordId = item.id || null; // 恢复后重试时，原地替换这条历史记录而不是新增一条
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
dom.clearHistory?.addEventListener("click", async () => {
  if (!(await askConfirm("确定清空全部生图记录？"))) return;
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

  function request(action, payload = {}, timeoutMs = 120000) {
    if (!available()) return Promise.reject(new Error("native bridge unavailable"));
    const id = `req_${Date.now()}_${seq++}`;
    FlutterDownload.postMessage(JSON.stringify({ id, action, ...payload }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        // 这条消息以前写死"Android"，但这个桥接函数在 Windows/Android 上是同一份代码、同一个
        // 调用路径，Windows 端超时也会走到这里——之前的措辞会让 Windows 用户误以为是安卓端才有
        // 的问题。改成不带平台名、带上具体 action，方便定位到底是哪个操作卡住了。
        reject(new Error(`原生功能调用超时（${action}），请重试`));
      }, timeoutMs);
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
    chooseDir(kind) { return request("chooseDir", { kind }, 15 * 60 * 1000); },
    nativeFetch(url, method, headers, body) {
      return request("nativeFetch", withDesktopProxyPayload({ url, method, headers, body }));
    },
    nativeFetchPayload(payload, timeoutMs) {
      return request("nativeFetch", withDesktopProxyPayload(payload), timeoutMs);
    },
    nativeFetchBlob(url) {
      return request("nativeFetch", withDesktopProxyPayload({ url, method: "GET", responseType: "base64" }));
    },
    openExternal(url) {
      return request("openExternal", { url });
    },
    saveFile(kind, fileName, mimeType, base64, folder = "") {
      return request("saveFile", { kind, fileName, mimeType, base64, folder });
    },
    downloadUpdate(url, fileName, install, platform) {
      return request("downloadUpdate", withDesktopProxyPayload({ url, fileName, install: !!install, platform }), 15 * 60 * 1000);
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
    showStatus(kind === "images" ? "正在打开图片目录选择器…" : "正在打开 ZIP 目录选择器…", "info");
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
      // 优先用生成时抓下来的本地字节：远程生图 URL 可能已被中转站删除（约 2 小时），
      // 只有本地缓存能保证"页面上显示什么，ZIP 里就有什么"。
      let blob = image.blob instanceof Blob ? image.blob : null;
      if (!blob && image.cachePromise) {
        blob = await Promise.resolve(image.cachePromise).catch(() => null);
        if (!(blob instanceof Blob)) blob = null;
      }
      if (!blob) blob = await imageUrlToBlob(image.url || image.imageUrl, pct => {
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

async function downloadImage(imageSource, index) {
  try {
    setDownloadProgress(3, "准备下载图片…");
    const filename = `panel-${index}.png`;
    // imageSource 可以是生成时缓存的 Blob（远程生图 URL 约 2 小时被删，本地字节才可靠），
    // 也可以是 data:/blob:/https: 字符串。
    const blob = imageSource instanceof Blob
      ? imageSource
      : await imageUrlToBlob(imageSource, pct => {
          setDownloadProgress(Math.max(5, Math.min(85, pct * 0.85)), `图片下载中 ${pct}%`);
        });
    const knownBase64 = typeof imageSource === "string" && imageSource.startsWith("data:")
      ? imageSource.split(",")[1]
      : "";
    await saveOrDownloadBlob(blob, filename, blob.type || "image/png", "images", knownBase64);
    setDownloadProgress(100, `下载成功：panel-${index}.png`, true);
  } catch (err) {
    hideDownloadProgress();
    showStatus(`下载失败: ${err.message || err}`, "error");
    if (typeof imageSource === "string") await openExternalUrl(imageSource);
  }
}

async function openExternalUrl(url) {
  const target = String(url || "").trim();
  if (!/^https?:\/\//i.test(target)) return false;
  if (nativeDownload.available() && typeof nativeDownload.openExternal === "function") {
    try {
      await nativeDownload.openExternal(target);
      return true;
    } catch (err) {
      console.warn("openExternal failed, falling back to window.open", err);
    }
  }
  const popup = window.open(target, "_blank", "noopener,noreferrer");
  return !!popup;
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
      if (card._zipImage?.url) {
        return {
          ...card._zipImage,
          blob: card._zipBlob || null,
          cachePromise: card._imageCachePromise || null,
        };
      }
      const img = card.querySelector("img");
      if (!img?.src) return null;
      const isProjectContext = card._retryContext?.mode === "comic" || card._retryContext?.mode === "caption";
      return {
        url: img.src,
        panelId: card._retryContext?.panelId || String(index + 1),
        prompt: isProjectContext
          ? getPanelOnlyPrompt(card._retryContext, card._retryContext?.globalPrompt || "")
          : (card._retryContext?.prompt || img.alt || ""),
        panelPrompt: isProjectContext ? getPanelOnlyPrompt(card._retryContext, card._retryContext?.globalPrompt || "") : "",
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
      folder: currentMode === "comic" ? "comic-project" : currentMode === "caption" ? "caption-project" : "images",
      mode: currentMode,
      title: currentMode === "comic" ? cleanText("comicProject") : currentMode === "caption" ? cleanText("captionProject") : cleanText("appTitle"),
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

dom.saveComicFolder.addEventListener("click", saveProjectResultsToFolder);

async function saveProjectResultsToFolder() {
  if (!nativeDownload.available()) return;
  const images = getCurrentResultImages();
  if (images.length === 0) {
    showStatus(cleanText("noImagesToExport"), "error"); return;
  }

  const isCaption = currentMode === "caption";

  dom.saveComicFolder.disabled = true;
  setButtonText(dom.saveComicFolder, "spark", "savingToFolder");
  setDownloadProgress(2, cleanText("savingToFolder"));

  try {
    if (!nativeDownload.dirs.images) {
      await nativeDownload.chooseDir("images");
    }
    const folder = sanitizeFilePart(`${isCaption ? "嵌字" : "漫画"}_${new Date().toLocaleString("zh-CN")}`, isCaption ? "caption" : "comic");
    const failures = [];
    let saved = 0;

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const panelId = sanitizeFilePart(image.panelId || i + 1, String(i + 1));
      try {
        setDownloadProgress(4 + Math.round((i / Math.max(images.length, 1)) * 90), `${cleanText("collectingImages")} ${i + 1}/${images.length}`);
        // 与 buildImagesZip 相同的容错取字节顺序：生成时缓存的字节最可靠，远程 URL 可能已过期。
        let blob = image.blob instanceof Blob ? image.blob : null;
        if (!blob && image.cachePromise) {
          blob = await Promise.resolve(image.cachePromise).catch(() => null);
          if (!(blob instanceof Blob)) blob = null;
        }
        if (!blob) blob = await imageUrlToBlob(image.url || image.imageUrl);
        const ext = imageExtFromBlob(image.url || image.imageUrl, blob);
        const base64 = await blobToBase64(blob);
        await nativeDownload.saveFile("images", `${isCaption ? "image" : "panel"}-${panelId}.${ext}`, blob.type || "image/png", base64, folder);
        saved++;
      } catch (err) {
        failures.push(`${image.panelId || i + 1}: ${err.message || err}`);
      }
    }

    if (saved === 0) throw new Error(failures.join("; ") || cleanText("exportFailed"));
    setDownloadProgress(100, `${cleanText("folderSaved")}: ${folder}`, true);
    showStatus(
      failures.length ? `${cleanText("folderSaved")}: ${saved}/${images.length}` : `${cleanText("folderSaved")}: ${folder}`,
      failures.length ? "error" : "success"
    );
  } catch (err) {
    hideDownloadProgress();
    showStatus(`${cleanText("exportFailed")}: ${err.message || err}`, "error");
  } finally {
    dom.saveComicFolder.disabled = false;
    setButtonText(dom.saveComicFolder, "folder", "saveToFolder");
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
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    updateBodyScrollLock();
  };
  overlay.addEventListener("click", close);
  document.body.appendChild(overlay);
  updateBodyScrollLock();
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
}

// ═══════════════════════════════════════════════════════════
//  生成按钮入口
// ═══════════════════════════════════════════════════════════

dom.generateBtn.addEventListener("click", () => {
  if (currentMode === "comic") generateComic();
  else if (currentMode === "caption") generateCaptions();
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

// 启动时静默检测一次更新；如果有新版本，弹窗询问是否立即更新（不打扰用户的话直接取消即可）。
async function checkForUpdatesOnLaunch() {
  try {
    const info = await checkForUpdates({ silent: true });
    if (!info?.isNewer) return;
    const message = `${interpolate(cleanText("updateAvailable"), { version: `v${info.latest}` })}\n${cleanText("updateNowPrompt")}`;
    const shouldUpdate = await askConfirm(message);
    if (shouldUpdate) await downloadLatestUpdate(true);
  } catch (err) {
    console.warn("Startup update check failed:", err);
  }
}

initI18n();
registerServiceWorker();
initManualWheelScrollFix();
setTimeout(() => { void checkForUpdatesOnLaunch(); }, 1200);
