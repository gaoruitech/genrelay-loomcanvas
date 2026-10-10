export default {
  'zh-CN': {
    title: '素材库',
    sub: '上传的参考图和存下来的生成结果都在这里，在画布的资源库里可以直接取用。',
    upload: '上传素材',

    kinds: {
      product: '产品图',
      brand: '品牌素材',
      reference: '参考',
      output: '成品',
    },
    types: { image: '图片', video: '视频' },

    filter: {
      kind: '分类',
      type: '类型',
      typeAll: '类型：全部',
      typeImage: '只看图片',
      typeVideo: '只看视频',
      folder: '文件夹',
      folderAll: '文件夹：全部',
      search: '搜索素材名称',
      reset: '重置筛选',
    },

    drop: {
      title: '拖拽文件到这里',
      pick: '或点击选择文件',
      formats: '图片或视频',
      limit: '单个不超过 {mb} MB',
      into: '存入「{kind}」',
      release: '松开即可上传',
      uploading: '正在上传 {i} / {n}',
    },

    source: { upload: '上传', generated: '生成结果' },
    unnamed: '未命名',
    select: '选择',
    deselect: '取消选择',
    preview: '预览',

    sel: {
      count: '已选 {n} 项',
      breakdown: '图片 {image} · 视频 {video}',
      download: '下载',
      move: '移动到',
      rename: '重命名',
      copyLink: '复制链接',
      delete: '删除',
      cancel: '取消选择',
    },

    shown: '已显示 {n} / {total}',
    shownFiltered: '已加载的 {loaded} 个里有 {n} 个符合 · 共 {total} 个',
    loadMore: '加载更多',
    allLoaded: '全部 {total} 个都在这里了',

    empty: '还没有素材',
    emptyHint: '把图片或视频拖进来，或者点下面的按钮上传。在画布里右键生成结果，也可以「存入我的资产」。',
    emptyKind: '这一类还没有素材',
    emptyFiltered: '没有符合条件的素材',
    loadFailed: '素材加载失败',

    uploadFailed: '「{name}」上传失败：{reason}',
    uploaded: '已上传 {n} 个',
    notMedia: '只能上传图片或视频',

    downloading: '正在下载 {i} / {n}…',
    downloaded: '已下载 {n} 个',
    downloadFailed: '「{name}」下载失败',
    linkCopied: '链接已复制',

    renameDialog: {
      title: '重命名',
      label: '名称',
      done: '已重命名',
    },
    moveDialog: {
      title: '移动到文件夹',
      label: '文件夹名称',
      placeholder: '输入新的文件夹名，或在下面选一个',
      existing: '已有的文件夹',
      none: '还没有文件夹。输入一个名字，移动后它就出现了。',
      out: '移出文件夹',
      confirm: '移动',
      done: '已移动 {n} 个',
      doneOut: '已把 {n} 个移出文件夹',
    },
    removeDialog: {
      title: '删除素材',
      one: '确定删除「{name}」？已经放进画布的节点不受影响。',
      many: '确定删除选中的 {n} 个素材？已经放进画布的节点不受影响。',
      done: '已删除 {n} 个',
      partial: '已删除 {ok} 个，{fail} 个失败',
    },
  },

  en: {
    title: 'Assets',
    sub: 'Uploaded references and saved results live here, ready to pick from the library inside a canvas.',
    upload: 'Upload',

    kinds: {
      product: 'Product shots',
      brand: 'Brand assets',
      reference: 'References',
      output: 'Outputs',
    },
    types: { image: 'Image', video: 'Video' },

    filter: {
      kind: 'Category',
      type: 'Type',
      typeAll: 'Type: all',
      typeImage: 'Images only',
      typeVideo: 'Videos only',
      folder: 'Folder',
      folderAll: 'Folder: all',
      search: 'Search by name',
      reset: 'Reset filters',
    },

    drop: {
      title: 'Drop files here',
      pick: 'or click to choose',
      formats: 'Images or videos',
      limit: 'up to {mb} MB each',
      into: 'Saved to "{kind}"',
      release: 'Release to upload',
      uploading: 'Uploading {i} / {n}',
    },

    source: { upload: 'Upload', generated: 'Generated' },
    unnamed: 'Untitled',
    select: 'Select',
    deselect: 'Deselect',
    preview: 'Preview',

    sel: {
      count: '{n} selected',
      breakdown: 'Images {image} · Videos {video}',
      download: 'Download',
      move: 'Move to',
      rename: 'Rename',
      copyLink: 'Copy link',
      delete: 'Delete',
      cancel: 'Clear selection',
    },

    shown: 'Showing {n} of {total}',
    shownFiltered: '{n} of the {loaded} loaded match · {total} in total',
    loadMore: 'Load more',
    allLoaded: 'All {total} are shown',

    empty: 'No assets yet',
    emptyHint: 'Drop images or videos here, or use the button below. On a canvas, right-click a result to save it to your assets.',
    emptyKind: 'Nothing in this category yet',
    emptyFiltered: 'No assets match',
    loadFailed: 'Could not load the assets',

    uploadFailed: 'Could not upload "{name}": {reason}',
    uploaded: 'Uploaded {n}',
    notMedia: 'Only images and videos can be uploaded',

    downloading: 'Downloading {i} / {n}…',
    downloaded: 'Downloaded {n}',
    downloadFailed: 'Could not download "{name}"',
    linkCopied: 'Link copied',

    renameDialog: {
      title: 'Rename',
      label: 'Name',
      done: 'Renamed',
    },
    moveDialog: {
      title: 'Move to folder',
      label: 'Folder name',
      placeholder: 'Type a new folder name, or pick one below',
      existing: 'Existing folders',
      none: 'No folders yet. Type a name and it appears once something is moved in.',
      out: 'Remove from folder',
      confirm: 'Move',
      done: 'Moved {n}',
      doneOut: 'Removed {n} from the folder',
    },
    removeDialog: {
      title: 'Delete assets',
      one: 'Delete "{name}"? Nodes already on a canvas are not affected.',
      many: 'Delete the {n} selected assets? Nodes already on a canvas are not affected.',
      done: 'Deleted {n}',
      partial: 'Deleted {ok}, {fail} failed',
    },
  },
}
