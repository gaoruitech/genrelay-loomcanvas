<template>
  <div class="lc-page">
    <div class="lc-page-inner">
      <div class="lc-page-head">
        <div class="mp-head">
          <h1 class="lc-ph1">{{ t('modelsPage.title') }}</h1>
          <p class="lc-ph-sub">{{ space.isTeam ? t('modelsPage.team.sub', { team: space.name }) : t($feat.cost ? 'modelsPage.sub' : 'modelsPage.subNoPrice') }}</p>
        </div>
        <span class="lc-sp"></span>
        <span v-if="readOnly" class="ro-chip" data-role="readonly-chip"><LcIcon name="eye" size="s" />{{ t('modelsPage.team.readOnly') }}</span>
        <button v-else-if="!loading && !loadError" class="lc-btn" :disabled="!vendors.length" data-act="add-provider" @click="openAdd()">
          <LcIcon name="plus" />{{ t('modelsPage.addProvider') }}
        </button>
      </div>

      <!-- 团队空间：这一页是谁的服务商、Key 归谁管 -->
      <div v-if="space.isTeam" class="lc-alert info team-note" data-role="team-note">
        <LcIcon name="shield" size="s" />
        <i18n-t :keypath="readOnly ? 'modelsPage.team.noteMember' : 'modelsPage.team.noteManager'" tag="span" scope="global">
          <template #team><b>{{ space.name }}</b></template>
        </i18n-t>
      </div>

      <!-- 冷启动：骨架 -->
      <div v-if="loading" class="mm" aria-busy="true" :aria-label="t('common.loading')">
        <div class="mm-side">
          <div class="mm-cards">
            <div v-for="n in 2" :key="n" class="lc-card pc sk-card" aria-hidden="true">
              <div class="pc-top"><span class="sk sk-pi"></span><div class="sk-lines"><span class="sk" style="width: 96px; height: 14px"></span><span class="sk" style="width: 168px; height: 10px"></span></div></div>
              <span v-for="i in 3" :key="i" class="sk" style="height: 12px"></span>
              <span class="sk" style="height: 28px"></span>
            </div>
          </div>
        </div>
        <div class="lc-card mpanel" aria-hidden="true">
          <div class="mp-top"><span class="sk sk-pi"></span><div class="sk-lines"><span class="sk" style="width: 160px; height: 16px"></span><span class="sk" style="width: 220px; height: 10px"></span></div></div>
          <div class="sk-bar"><span class="sk" style="height: 32px"></span></div>
          <div v-for="n in 7" :key="n" class="sk-row">
            <span class="sk" style="width: 36px; height: 20px; border-radius: 10px"></span>
            <div class="sk-lines"><span class="sk" style="width: 140px; height: 13px"></span><span class="sk" style="width: 110px; height: 10px"></span></div>
            <span class="sk sk-grow" style="height: 22px"></span>
          </div>
        </div>
      </div>

      <!-- 取不到数据 -->
      <div v-else-if="loadError" class="lc-card mp-state" role="alert">
        <LcIcon name="warn" size="xl" class="mp-state-ic err" />
        <p class="mp-state-title">{{ t('common.loadFailed') }}</p>
        <p class="mp-state-text">{{ loadError }}</p>
        <button class="lc-btn" @click="load"><LcIcon name="refresh" size="s" />{{ t('common.retry') }}</button>
      </div>

      <!-- 一个服务商都还没有 -->
      <template v-else-if="!providers.length">
        <div class="lc-card lc-gb mp-state mp-empty">
          <span class="mp-empty-ic"><LcIcon name="server" size="xl" /></span>
          <template v-if="readOnly">
            <p class="mp-state-title">{{ t('modelsPage.team.emptyTitle') }}</p>
            <p class="mp-state-text">{{ t('modelsPage.team.emptyMember') }}</p>
          </template>
          <template v-else>
            <p class="mp-state-title">{{ t('modelsPage.empty.title') }}</p>
            <p class="mp-state-text">{{ space.isTeam ? t('modelsPage.team.emptyManager') : t('modelsPage.empty.text') }}</p>
            <button class="lc-btn primary" :disabled="!vendors.length" data-act="add-first-provider" @click="openAdd()">
              <LcIcon name="plus" />{{ t('modelsPage.addProvider') }}
            </button>
          </template>
        </div>
        <div v-if="$feat.cost" class="lc-card mm-about mp-empty-about">
          <div class="lc-row"><LcIcon name="key" class="about-ic" /><b>{{ t('modelsPage.about.title') }}</b></div>
          <p>{{ aboutText }}</p>
        </div>
      </template>

      <div v-else class="mm">
        <!-- 左列：服务商 -->
        <div class="mm-side" :class="{ ro: readOnly, one: providers.length === 1 }">
          <div class="mm-cards">
          <div class="mm-provs" role="list" :aria-label="t('modelsPage.providersLabel')">
            <article
              v-for="p in providers"
              :key="p.id"
              class="lc-card pc"
              :class="{ 'sel lc-gb': p.id === current?.id }"
              role="listitem"
              :data-provider="p.id"
              @click="select(p.id)"
            >
              <div class="pc-top">
                <span class="pi" aria-hidden="true">{{ initialOf(p) }}</span>
                <div class="pc-tt">
                  <div class="pc-name-row">
                    <h3>
                      <button type="button" class="pc-name" :aria-pressed="p.id === current?.id" :aria-label="t('modelsPage.card.select', { name: p.name })" @click.stop="select(p.id)">{{ p.name }}</button>
                    </h3>
                    <span v-if="vendorOf(p)?.recommended" class="lc-bd rec">{{ t('modelsPage.provider.recommended') }}</span>
                  </div>
                  <span class="pc-sub" v-tip="{ text: taglineOf(p), clipped: true }">{{ taglineOf(p) }}</span>
                </div>
              </div>
              <dl>
                <dt>{{ t('modelsPage.card.status') }}</dt>
                <dd><span class="lc-st" :class="statusOf(p).cls" data-role="status">{{ statusOf(p).text }}</span></dd>
                <dt>{{ t('modelsPage.card.apiKey') }}</dt>
                <!-- 成员：只说配没配，不出现 Key 的任何一截，也没有地址 -->
                <template v-if="readOnly">
                  <!-- Key 存着但服务端解不开了：成员只需要知道「现在用不了、该找谁」 -->
                  <dd v-if="p.keyUnreadable" class="lc-t3" data-role="key" data-key-state="unreadable">{{ t('modelsPage.team.keyUnusable') }}</dd>
                  <dd v-else-if="p.hasKey" class="key-team" data-role="key"><LcIcon name="lock" size="s" />{{ t('modelsPage.team.keyByTeam') }}</dd>
                  <dd v-else class="lc-t3" data-role="key">{{ t('modelsPage.team.keyMissing') }}</dd>
                </template>
                <dd v-else-if="p.keyUnreadable" class="key-lost" data-role="key" data-key-state="unreadable">{{ t('modelsPage.card.keyUnreadable') }}</dd>
                <dd v-else-if="p.hasKey" data-role="key">{{ t('modelsPage.card.keySet') }}<span v-if="p.keyTail" class="lc-mono key-tail"> ····{{ p.keyTail }}</span></dd>
                <dd v-else class="lc-t3" data-role="key">{{ t('modelsPage.card.keyUnset') }}</dd>
                <dt>{{ t('modelsPage.card.models') }}</dt>
                <dd>{{ t('modelsPage.card.count', countsOf(p.id)) }}</dd>
                <template v-if="!readOnly && p.customBaseUrl && p.baseUrl">
                  <dt>{{ t('modelsPage.card.address') }}</dt>
                  <dd class="pc-url lc-mono" v-tip="t('modelsPage.provider.customAddress') + ' · ' + p.baseUrl">{{ p.baseUrl }}</dd>
                </template>
                <!-- 上次测试是什么时候（只有能管服务商的人看得到测试结果） -->
                <template v-if="!readOnly && p.lastTest && testing !== p.id">
                  <dt>{{ t('modelsPage.card.lastTest') }}</dt>
                  <dd class="pc-when" data-role="last-test" v-tip="formatDateTime(p.lastTest.at)">{{ formatRecent(p.lastTest.at) }}</dd>
                </template>
                <!-- 维护人：最后一次真的改了它的人——有问题该找谁。成员也看得到 -->
                <template v-if="p.maintainer">
                  <dt>{{ t('modelsPage.card.maintainer') }}</dt>
                  <dd class="pc-who" data-role="maintainer">
                    <PersonName :person="p.maintainer" :you="p.maintainer.id === app.user?.id" />
                    <small v-if="p.updatedAt" v-tip="formatDateTime(p.updatedAt)">{{ t('modelsPage.card.changedAt', { time: formatRecent(p.updatedAt) }) }}</small>
                  </dd>
                </template>
              </dl>
              <!-- Key 读不出来：说清楚原因和后果，下面那颗按钮直接去重填。这时上一次的测试结果已经说明不了什么 -->
              <p v-if="!readOnly && p.keyUnreadable" class="pc-msg" role="status" data-role="key-unreadable">{{ t('modelsPage.card.keyUnreadableText') }}</p>
              <p v-else-if="!readOnly && p.lastTest && !p.lastTest.ok && p.lastTest.message && testing !== p.id" class="pc-msg" role="status" data-role="test-message">{{ p.lastTest.message }}</p>
              <div v-if="!readOnly" class="pc-ops">
                <button v-if="p.keyUnreadable" class="lc-btn sm fill-key" data-act="refill-key" @click.stop="openEdit(p)"><LcIcon name="key" size="s" />{{ t('modelsPage.card.refillKey') }}</button>
                <template v-else-if="p.hasKey">
                  <button class="lc-btn sm" :disabled="testing === p.id" data-act="test" @click.stop="test(p)">
                    <LcIcon name="refresh" size="s" :class="{ spinning: testing === p.id }" />{{ t('modelsPage.card.test') }}
                  </button>
                  <button class="lc-btn sm" data-act="edit" @click.stop="openEdit(p)"><LcIcon name="edit" size="s" />{{ t('common.edit') }}</button>
                </template>
                <button v-else class="lc-btn sm fill-key" data-act="edit" @click.stop="openEdit(p)"><LcIcon name="key" size="s" />{{ t('modelsPage.card.fillKey') }}</button>
              </div>
            </article>
          </div>

          <!-- 还可以添加的：清单里有、但还没添加的服务商，加一个「添加」入口。窄屏上它们是一行一个的小条 -->
          <div v-if="!readOnly" class="mm-more">
            <div v-if="idleVendors.length" class="mm-idle" role="list" :aria-label="t('modelsPage.idleLabel')">
            <article v-for="v in idleVendors" :key="'v-' + v.type" class="lc-card pc idle" role="listitem" :data-vendor="v.type">
              <div class="pc-top">
                <span class="pi" aria-hidden="true">{{ initial(vendorLabel(v)) }}</span>
                <div class="pc-tt">
                  <div class="pc-name-row">
                    <h3>{{ vendorLabel(v) }}</h3>
                    <span v-if="v.recommended" class="lc-bd rec">{{ t('modelsPage.provider.recommended') }}</span>
                  </div>
                  <span class="pc-sub" v-tip="{ text: vendorDesc(v), clipped: true }">{{ vendorDesc(v) }}</span>
                </div>
              </div>
              <dl>
                <dt>{{ t('modelsPage.card.status') }}</dt>
                <dd><span class="lc-st wait">{{ t('modelsPage.st.unconfigured') }}</span></dd>
                <dt>{{ t('modelsPage.card.apiKey') }}</dt>
                <dd class="lc-t3">{{ t('modelsPage.card.keyUnset') }}</dd>
                <dt>{{ t('modelsPage.card.models') }}</dt>
                <dd>{{ t('modelsPage.card.afterKey') }}</dd>
              </dl>
              <div class="pc-ops">
                <button class="lc-btn sm fill-key" @click="openAdd(v.type)"><LcIcon name="key" size="s" />{{ t('modelsPage.card.fillKey') }}</button>
              </div>
            </article>
            </div>

            <button type="button" class="padd" :disabled="!vendors.length" data-act="add-tile" @click="openAdd()">
              <LcIcon name="plus" /><span>{{ t('modelsPage.addTile') }}</span>
            </button>
          </div>
          </div>

          <div v-if="$feat.cost" class="lc-card mm-about">
            <div class="lc-row"><LcIcon name="key" class="about-ic" /><b>{{ t('modelsPage.about.title') }}</b></div>
            <p>{{ aboutText }}</p>
          </div>
        </div>

        <!-- 右侧：当前服务商的模型 -->
        <!-- no-price：集成方关了成本显示（features.cost）—— 没有价格那一列、那个筛选项、「填价格」那颗按钮和「关于价格」那张卡片 -->
        <section v-if="current" class="lc-card mpanel" :class="{ ro: readOnly, blk: uncountable.size > 0 && $feat.cost, 'no-price': !$feat.cost }" :aria-labelledby="'mp-title'">
          <div class="mp-top">
            <span class="pi" aria-hidden="true">{{ initialOf(current) }}</span>
            <div class="mp-tt">
              <h2 id="mp-title">{{ t('modelsPage.panel.title', { name: current.name }) }}</h2>
              <span class="mp-counts" aria-live="polite">
                {{ t('modelsPage.panel.counts', { n: providerModels.length, ...kindCounts }) }}
                <template v-if="filtering"> · {{ t('modelsPage.panel.shown', { shown: shownCount, total: providerModels.length }) }}</template>
              </span>
            </div>
            <span class="lc-sp"></span>
            <button v-if="canAddCustom && !readOnly" class="lc-btn primary" data-act="add-custom" @click="openAddCustom">
              <LcIcon name="plus" />{{ t('modelsPage.custom.add') }}
            </button>
            <!-- 成员只读：只留按类型看这一项，放在标题右边 -->
            <div v-if="readOnly" class="lc-seg ro-seg" role="radiogroup" :aria-label="t('modelsPage.filter.kind')" @keydown="onSegKey">
              <button
                v-for="k in KIND_TABS"
                :key="k || 'all'"
                type="button"
                :class="{ on: filters.kind === k }"
                role="radio"
                :aria-checked="filters.kind === k"
                :tabindex="filters.kind === k ? 0 : -1"
                :data-kind="k || 'all'"
                @click="filters.kind = k"
              >{{ k ? kindLabel(k) : t('modelsPage.filter.all') }}</button>
            </div>
          </div>

          <div v-if="current.keyUnreadable" class="lc-alert warn mp-alert" data-role="panel-key-unreadable">
            <LcIcon name="warn" size="s" />
            <span>{{ readOnly ? t('modelsPage.team.unusableHint') : t('modelsPage.panel.keyUnreadableHint') }}</span>
            <button v-if="!readOnly" type="button" class="lc-btn sm mp-alert-act" data-act="panel-refill-key" @click="openEdit(current)"><LcIcon name="key" size="s" />{{ t('modelsPage.card.refillKey') }}</button>
          </div>
          <div v-else-if="!current.hasKey || !current.enabled" class="lc-alert warn mp-alert">
            <LcIcon name="warn" size="s" />
            <span>{{ !current.hasKey ? t('modelsPage.panel.noKeyHint') : t('modelsPage.panel.disabledHint') }}</span>
          </div>

          <div v-if="!readOnly" class="lc-fbar mp-fbar" role="group" :aria-label="t('modelsPage.filter.title')">
            <div class="lc-seg" role="radiogroup" :aria-label="t('modelsPage.filter.kind')" @keydown="onSegKey">
              <button
                v-for="k in KIND_TABS"
                :key="k || 'all'"
                type="button"
                :class="{ on: filters.kind === k }"
                role="radio"
                :aria-checked="filters.kind === k"
                :tabindex="filters.kind === k ? 0 : -1"
                :data-kind="k || 'all'"
                @click="filters.kind = k"
              >{{ k ? kindLabel(k) : t('modelsPage.filter.all') }}</button>
            </div>
            <LcSelect v-model="filters.status" class="f-select" size="sm" :options="statusOptions" :aria-label="t('modelsPage.filter.status')" data-filter="status" />
            <LcSelect v-model="filters.source" class="f-select" size="sm" :options="sourceOptions" :aria-label="t('modelsPage.filter.source')" data-filter="source" />
            <LcSelect v-if="$feat.cost" v-model="filters.price" class="f-select" size="sm" :options="priceOptions" :aria-label="t('modelsPage.filter.price')" data-filter="price" />
            <label class="lc-inp sm grow f-search">
              <LcIcon name="search" size="s" />
              <input v-model="keyword" type="search" :placeholder="t('modelsPage.filter.search')" :aria-label="t('modelsPage.filter.search')" />
            </label>
            <button v-if="filtering" type="button" class="lc-btn sm text" data-act="clear-filters" @click="clearFilters">{{ t('modelsPage.filter.clear') }}</button>
          </div>

          <div class="mtable" role="table" :aria-labelledby="'mp-title'">
            <div class="mcols" role="row">
              <span role="columnheader">{{ t('modelsPage.cols.enabled') }}</span>
              <span role="columnheader">{{ t('modelsPage.cols.model') }}</span>
              <span role="columnheader">{{ t('modelsPage.cols.caps') }}</span>
              <span v-if="$feat.cost" role="columnheader">{{ t('modelsPage.cols.price') }}</span>
              <span v-if="!readOnly" role="columnheader" class="c-act-h">{{ t('modelsPage.cols.actions') }}</span>
            </div>

            <template v-for="g in groups" :key="g.kind">
              <div class="mgrp" role="row" :data-group="g.kind">
                <span role="cell" class="mgrp-in"><span class="lc-bd" :class="g.kind">{{ kindLabel(g.kind) }}</span>{{ t('modelsPage.groupCount', { n: g.models.length }) }}</span>
              </div>
              <div v-for="m in g.models" :key="m.id" class="mrow" :class="{ off: !m.enabled }" role="row" :data-model="m.id">
                <div class="c-sw" role="cell">
                  <button
                    v-if="readOnly"
                    type="button"
                    class="lc-switch ro"
                    :class="{ on: m.enabled }"
                    role="switch"
                    aria-disabled="true"
                    :aria-checked="m.enabled"
                    :aria-label="t('modelsPage.row.enable', { name: m.label || upstreamName(m) })"
                    v-tip="t('modelsPage.team.switchLocked')"
                  />
                  <button
                    v-else
                    class="lc-switch"
                    :class="{ on: m.enabled }"
                    :disabled="busy === m.id"
                    role="switch"
                    :aria-checked="m.enabled"
                    :aria-label="t('modelsPage.row.enable', { name: m.label || upstreamName(m) })"
                    @click="patch(m, { enabled: !m.enabled })"
                  />
                </div>
                <div class="c-name" role="cell">
                  <b v-tip="{ text: m.label, clipped: true }">{{ m.label || upstreamName(m) }}</b>
                  <small v-tip="{ text: upstreamName(m), clipped: true }">{{ upstreamName(m) }}</small>
                </div>
                <div class="c-caps" role="cell">
                  <CapChips :chips="chipsOf(m)" />
                  <span v-if="kept.has(m.id) && !matches(m)" v-tip="t('modelsPage.row.keptHint')" class="lc-tag warn kept-tag" tabindex="0">{{ t('modelsPage.row.kept') }}</span>
                </div>
                <!-- 成员：只看价格填没填（悬停能看到填的是多少） -->
                <div v-if="readOnly && $feat.cost" class="c-price" role="cell" data-role="price">
                  <span v-if="!m.enabled" class="lc-tag">{{ t('modelsPage.team.priceOff') }}</span>
                  <!-- 我现在跑不了这个模型（金额上限 + 没有能算的价格）：服务端给的答案，连该找谁一起说 -->
                  <span v-else-if="cannotRunOf(m)" v-tip="cannotRunOf(m)" class="lc-tag warn blocked-tag" tabindex="0" data-role="blocked">{{ t('spaces.refusal.model.tag') }}</span>
                  <span v-else-if="pricingParts(m.pricing).length" v-tip="pricingParts(m.pricing).join(' · ')" class="lc-tag ok" tabindex="0">{{ t('modelsPage.team.priceSet') }}</span>
                  <span v-else v-tip="t('modelsPage.team.priceUnsetHint')" class="lc-tag warn" tabindex="0">{{ t('modelsPage.team.priceUnset') }}</span>
                </div>
                <div v-else-if="$feat.cost" class="c-price" role="cell" data-role="price">
                  <!-- 团队设了金额上限且不放行算不了成本的模型：这一个现在跑不了，说清楚为什么 -->
                  <span v-if="blockedOf(m) === 'unpriced'" v-tip="blockedHint(m)" class="lc-tag warn blocked-tag" tabindex="0" data-role="blocked">{{ t('modelsPage.team.blockedUnpriced') }}</span>
                  <span v-else-if="!priceOf(m)" class="lc-unk">{{ t('modelsPage.row.unset') }}</span>
                  <!-- 货币对不上：价格收成一行（悬停看全），下面一行说它现在跑不了 —— 行高和别的行一样 -->
                  <template v-else-if="blockedOf(m) === 'currency'">
                    <span v-tip="pricingParts(m.pricing).join(' · ')" class="pp-line" tabindex="0">{{ pricingParts(m.pricing).join(' · ') }}</span>
                    <span v-tip="blockedHint(m)" class="lc-tag warn blocked-tag" tabindex="0" data-role="blocked">{{ t('modelsPage.team.blockedCurrency') }}</span>
                  </template>
                  <!-- 按 token 计价：输入、输出两个单价上下对齐成一对，单位另起一行 -->
                  <template v-else-if="priceOf(m)!.kind === 'token'">
                    <span class="pp-pair" data-role="price-pair">
                      <span class="pp-l">{{ t('modelsPage.row.priceIn') }}</span><span class="pp-v" data-role="price-in">{{ (priceOf(m) as TokenPrice).input }}</span>
                      <span class="pp-l">{{ t('modelsPage.row.priceOut') }}</span><span class="pp-v" data-role="price-out">{{ (priceOf(m) as TokenPrice).output }}</span>
                    </span>
                    <span class="pp-unit">{{ priceOf(m)!.unit }}</span>
                  </template>
                  <template v-else>
                    <span class="pp-amt">{{ (priceOf(m) as FlatPrice).amount }}</span>
                    <span class="pp-unit">{{ priceOf(m)!.unit }}</span>
                  </template>
                </div>
                <div v-if="!readOnly" class="c-act" role="cell">
                  <button v-if="$feat.cost" class="lc-btn sm" :disabled="busy === m.id" data-act="price" @click="editing = m">
                    {{ m.pricing ? t('modelsPage.row.editPrice') : t('modelsPage.row.setPrice') }}
                  </button>
                  <RowMenu :items="menuOf(m)" :label="t('modelsPage.row.more')" :disabled="busy === m.id" @pick="onMenu(m, $event)" />
                </div>
              </div>
            </template>

            <div v-if="!groups.length" class="lc-empty mp-none">
              <p>{{ filtering ? t('modelsPage.filter.noMatch') : readOnly ? t('modelsPage.team.noModels') : t('common.empty') }}</p>
              <button v-if="filtering" type="button" class="lc-btn sm" @click="clearFilters">{{ t('modelsPage.filter.clear') }}</button>
            </div>
          </div>
        </section>
      </div>
    </div>

    <ProviderDialog
      v-if="providerDialog"
      :vendors="vendors"
      :existing="providerDialog.existing"
      :preset-vendor="providerDialog.vendor"
      @close="providerDialog = null"
      @saved="onProviderSaved"
      @removed="onProviderRemoved"
      @forbidden="onForbidden"
    />

    <PricingEditor
      v-if="editing"
      :model="editing"
      :saving="busy === editing.id"
      @close="editing = null"
      @save="savePricing"
    />

    <ModelEditDialog
      v-if="renaming"
      :model="renaming"
      :saving="busy === renaming.id"
      @close="renaming = null"
      @save="saveRename"
    />

    <CustomModelDialog
      v-if="customDialog"
      :provider="customDialog.provider"
      :vendor="customDialog.vendor"
      :existing="customDialog.existing"
      @close="customDialog = null"
      @saved="onCustomSaved"
      @forbidden="onForbidden"
    />

    <!-- 删除自定义模型 -->
    <Teleport :to="$lcPortal">
      <div v-if="removing" class="lc-mask lc-sheet" @click.self="cancelRemove">
        <div ref="confirmBox" class="lc-dialog confirm" role="alertdialog" aria-modal="true" aria-labelledby="mp-del-title" aria-describedby="mp-del-text">
          <div class="lc-dialog-head"><span id="mp-del-title">{{ t('modelsPage.custom.deleteTitle') }}</span></div>
          <div class="lc-dialog-body">
            <p id="mp-del-text">{{ t('modelsPage.custom.deleteText', { name: removing.model.label || upstreamName(removing.model) }) }}</p>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" :disabled="deleting" data-autofocus @click="cancelRemove">{{ t('common.cancel') }}</button>
            <button class="lc-btn danger" :disabled="deleting" data-act="confirm-delete-model" @click="confirmRemove">{{ t('common.delete') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { lcLocal } from '@/utils/storage'
/**
 * 「模型管理」页：左列是服务商，右边是选中那一家的模型。
 *
 * - 地址里的 ?provider=<id> 决定选中哪一家；没有（或那一家已经不在了）就是第一家。
 * - 每个模型的类型是明确的（来自服务商的模型清单，或自定义模型上用户选的），这里只是按它分组显示。
 * - 同一组里按「排序」数字从小到大排，数字相同按清单里的顺序 —— 画布下拉用的也是这个顺序。
 * - 四个筛选项记在这个浏览器里；搜索词不记。
 * - 筛选生效时改了某一行、它因此不再符合条件：这一行留在原地并标出来，
 *   等筛选条件变了再消失 —— 点一下开关行就没了，连撤销的机会都没有。
 * - 连通性测试的结果只在这一页的内存里：后端不保存，刷新之后回到「未测试」。
 *
 * 团队空间里：
 * - 团长和管理员（provider:manage）看到、能做的和个人空间一样，管的是团队的服务商（请求自动带着团队的 X-Space）。
 * - 成员只读：同样的布局，没有任何写操作和测试连接，Key 只说「已由团队配置」。后端给成员的服务商对象
 *   本来就不含 Key 末几位和地址（restricted），这一页也不去调成员调不了的接口。
 * - 开着页面时被降成成员：下一次写操作得到 403 team.forbidden，这时重取权限，页面变成只读。
 * - 团队设了金额上限且「算不了成本的模型不放行」时，没填价格（或币种对不上）的已启用模型标成「暂不可运行」。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { adminApi, teamApi, unwrap, apiErrorMessage, apiErrorCode, SPACE_GONE_CODES } from '@/utils/api'
import { loadModels } from '@/utils/canvasModels'
import { noteProviders } from '@/utils/storageHealth'
import { useDialogFocus } from '@/composables/useDialogFocus'
import { vendorDesc, vendorLabel, isVendorDefaultName } from '@/utils/providerMeta'
import { useAppStore } from '@/stores/app'
import { useSpaceStore } from '@/stores/space'
import LcIcon from '@/components/LcIcon.vue'
import LcSelect from '@/components/LcSelect.vue'
import PersonName from '@/components/PersonName.vue'
import { formatDateTime, formatRecent } from '@/components/space/format'
import ProviderDialog from '@/components/models/ProviderDialog.vue'
import PricingEditor from '@/components/models/PricingEditor.vue'
import CustomModelDialog from '@/components/models/CustomModelDialog.vue'
import ModelEditDialog from '@/components/models/ModelEditDialog.vue'
import RowMenu, { type ActionMenuItem as RowMenuItem } from '@/components/ActionMenu.vue'
import CapChips, { type CapChip } from '@/components/models/CapChips.vue'
import { capChips, pricingParts, pricingView, upstreamName, type PricingView } from '@/components/models/modelMeta'
import { modelBlock, refusalText } from '@/utils/budget'
import type { AdminModel, CustomModel, ModelKind, ModelPricing, ProviderInstance, ProviderTestResult, TeamLimits, Vendor } from '@/types'

const { t } = useI18n()
const app = useAppStore()
const space = useSpaceStore()
const route = useRoute()
const router = useRouter()

const KINDS: ModelKind[] = ['image', 'video', 'chat']
const KIND_TABS: (ModelKind | '')[] = ['', ...KINDS]
const kindLabel = (k: ModelKind) => t('modelsPage.kinds.' + k)

// ---- 数据 ----
const vendors = ref<Vendor[]>([])
const providers = ref<ProviderInstance[]>([])
const models = ref<AdminModel[]>([])
const loading = ref(true)
const loadError = ref('')

/**
 * 只读：团队里不能管理服务商的人（成员）。以服务端给的权限为准；
 * 权限那一份还没来得及更新、而服务商对象已经是受限的（restricted），也按只读。
 */
const readOnly = computed(() => space.isTeam && (!space.can('provider:manage') || providers.value.some(p => p.restricted)))

/**
 * 团队的上限。管理的人要它里面的 uncountable（全队范围：哪些模型算不进金额上限、对谁跑不了）；
 * 成员要 cannotRun（我自己现在跑不了哪些）和 managers（该找谁）。
 */
const limits = ref<TeamLimits | null>(null)
async function fetchLimits() {
  if (!space.isTeam) { limits.value = null; return }
  try {
    limits.value = unwrap(await teamApi.limits(space.currentId)) || null
  } catch {
    // 取不到只是少了「暂不可运行」的提示，页面照常用
    limits.value = null
  }
}

async function fetchAll() {
  const [vs, ps, ms] = await Promise.all([adminApi.vendors(), adminApi.providers(), adminApi.models(), fetchLimits()])
  vendors.value = unwrap(vs) || []
  providers.value = unwrap(ps) || []
  // 哪些服务商的 Key 解不开：画布上运行前的提示用的是同一份（见 utils/storageHealth）
  noteProviders(providers.value)
  models.value = unwrap(ms) || []
}

// 权限变了（被降成成员，或者升成了管理员）：这一页的数据重取一遍。成员拿到的服务商对象不含 Key 末几位和地址
watch(() => space.isTeam && space.can('provider:manage'), () => {
  if (!loading.value) void fetchAll().catch(() => undefined)
})

const limitCurrency = computed(() => limits.value?.currency || '')
/**
 * 因为金额上限现在跑不了的模型，和对谁跑不了。答案是服务端给的（上限接口的 uncountable[].blocked：
 * everyone 全队 / some 只有单独设了金额上限的成员 / none 不拦），这里不看上限和开关自己推。
 * 价格、启用状态一改就重取（见 saveModel 那里的 fetchLimits）。
 */
const uncountable = computed(() => {
  const map = new Map<string, { reason: 'unpriced' | 'currency'; blocked: 'everyone' | 'some' }>()
  for (const u of limits.value?.uncountable || []) if (u.blocked !== 'none') map.set(u.id, { reason: u.reason, blocked: u.blocked })
  return map
})
/** 这个模型是不是因为金额上限跑不了：'unpriced' 没填价格，'currency' 币种对不上，'' 不是 */
function blockedOf(m: AdminModel): 'unpriced' | 'currency' | '' {
  return m.enabled ? uncountable.value.get(m.id)?.reason || '' : ''
}
/** 成员看的那一列：我现在跑不了这个模型的话，是为什么、该找谁（一整句）；跑得了返回空串 */
function cannotRunOf(m: AdminModel): string {
  if (!m.enabled) return ''
  const hit = modelBlock(limits.value, m.id)
  return hit ? refusalText(hit).full : ''
}
/** 为什么跑不了、对谁跑不了，一句话 */
function blockedHint(m: AdminModel): string {
  const hit = uncountable.value.get(m.id)
  if (!hit) return ''
  const some = hit.blocked === 'some' ? 'Some' : ''
  return hit.reason === 'unpriced'
    ? t(`modelsPage.team.blockedUnpricedHint${some}`)
    : t(`modelsPage.team.blockedCurrencyHint${some}`, { currency: limitCurrency.value })
}

const aboutText = computed(() => readOnly.value
  ? t('modelsPage.team.aboutMember')
  : space.isTeam ? t('modelsPage.team.aboutManager') : t('modelsPage.about.text'))

/**
 * 写操作被拒绝了，因为调用者在团队里的角色变了（开着页面时被降成了成员）：
 * 说一声，重取权限和这一页的数据（成员拿到的服务商对象不含 Key 末几位和地址），页面随之变成只读。
 */
async function onForbidden(message: string) {
  providerDialog.value = null
  customDialog.value = null
  editing.value = null
  renaming.value = null
  removing.value = null
  MessagePlugin.error(message)
  await space.refresh()
  await fetchAll().catch(() => undefined)
}

/** 写操作出错后的统一处理。返回 true 表示已经处理过，调用处不用再提示 */
function handledWriteError(err: unknown): boolean {
  const code = apiErrorCode(err)
  // 空间没了：全局会把人送回个人空间并说明原因，这里不再弹一次
  if ((SPACE_GONE_CODES as readonly string[]).includes(code)) return true
  if (code === 'team.forbidden') {
    void onForbidden(apiErrorMessage(err, t('common.operationFailed')))
    return true
  }
  return false
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    await fetchAll()
  } catch (err) {
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** 服务商变了：启动信息里的 hasProvider 和画布用的模型清单都要跟着刷新 */
async function refreshAfterChange() {
  await Promise.all([
    app.loadBootstrap(),
    loadModels().catch(() => undefined),
  ])
}

// ---- 服务商 ----
const vendorOf = (p: ProviderInstance) => vendors.value.find(v => v.type === p.type) || null
const initial = (s: string) => (s.trim()[0] || '?').toUpperCase()
function initialOf(p: ProviderInstance): string {
  const v = vendorOf(p)
  return initial(v ? vendorLabel(v) : p.name || p.type)
}
/** 名字下面那一行：实例用的是服务商默认名时放一句介绍；自己起过名字的，说明它是哪一家 */
function taglineOf(p: ProviderInstance): string {
  const v = vendorOf(p)
  if (!v) return p.type
  return isVendorDefaultName(v, p.name) ? (vendorDesc(v) || vendorLabel(v)) : vendorLabel(v)
}
/** 清单里有、但一个实例都还没添加的服务商 */
const idleVendors = computed(() => vendors.value.filter(v => !providers.value.some(p => p.type === v.type)))

function countsOf(providerId: string): { n: number; on: number } {
  let n = 0
  let on = 0
  for (const m of models.value) {
    if (m.providerId !== providerId) continue
    n++
    if (m.enabled) on++
  }
  return { n, on }
}

const current = computed<ProviderInstance | null>(() => {
  const id = typeof route.query.provider === 'string' ? route.query.provider : ''
  return providers.value.find(p => p.id === id) || providers.value[0] || null
})

function select(id: string) {
  if (route.query.provider === id) return
  router.replace({ query: { ...route.query, provider: id } })
}

// ---- 连通性测试 ----
const testing = ref('')
/**
 * 一个服务商现在的状态。
 *  - 能管服务商的人（和个人空间）：最近一次连接测试的结果，服务端记着（lastTest），换了 Key / 地址之后服务端会清掉；
 *  - 团队成员：看不到测试结果（失败原因里可能带着上游的话），只说能不能用——启用了并且配了 Key 就是可用，
 *    绝不写「未测试」。
 */
function statusOf(p: ProviderInstance): { cls: string; text: string } {
  if (readOnly.value) {
    return p.enabled && p.hasKey && !p.keyUnreadable ? { cls: 'ok', text: t('modelsPage.team.stUsable') } : { cls: 'wait', text: t('modelsPage.team.stUnusable') }
  }
  if (testing.value === p.id) return { cls: 'run', text: t('modelsPage.st.testing') }
  if (!p.hasKey) return { cls: 'wait', text: t('modelsPage.st.noKey') }
  // 存着 Key、但服务端解不开了（SECRET_KEY 变了）：重新填写之前用不了，排在「已停用」「上次测试」之前说
  if (p.keyUnreadable) return { cls: 'err', text: t('modelsPage.st.keyUnreadable') }
  if (!p.enabled) return { cls: 'wait', text: t('modelsPage.st.disabled') }
  const r = p.lastTest
  if (!r) return { cls: 'wait', text: t('modelsPage.st.untested') }
  return r.ok ? { cls: 'ok', text: t('modelsPage.st.ok') } : { cls: 'err', text: t('modelsPage.st.lastFailed') }
}

/** 测完就地记下结果（和服务端记的是同一件事），不为这一项整页重取 */
function setLastTest(id: string, r: ProviderTestResult) {
  const p = providers.value.find(x => x.id === id)
  if (p) p.lastTest = { ok: !!r.ok, message: r.message || '', at: new Date().toISOString() }
}
async function test(p: ProviderInstance) {
  if (readOnly.value) return
  testing.value = p.id
  try {
    setLastTest(p.id, unwrap(await adminApi.testProvider(p.id)))
  } catch (err) {
    if (handledWriteError(err)) return
    setLastTest(p.id, { ok: false, message: apiErrorMessage(err, t('modelsPage.st.failed')) })
  } finally {
    testing.value = ''
  }
}

// ---- 添加 / 编辑 / 删除服务商 ----
const providerDialog = ref<{ existing: ProviderInstance | null; vendor?: string } | null>(null)

function openAdd(vendor?: string) {
  if (!vendors.value.length || readOnly.value) return
  providerDialog.value = { existing: null, vendor }
}

function openEdit(p: ProviderInstance) {
  if (readOnly.value) return
  if (!vendorOf(p)) {
    MessagePlugin.error(t('modelsPage.provider.unknownType', { type: p.type }))
    return
  }
  providerDialog.value = { existing: p }
}

async function onProviderSaved(saved: ProviderInstance | null, created: boolean) {
  providerDialog.value = null
  // 改过 Key 或地址之后上一次的测试结果不再说明什么：服务端已经清掉了，重取就是
  await fetchAll().catch(() => undefined)
  if (saved && created) select(saved.id)
  await refreshAfterChange()
}

async function onProviderRemoved(id: string) {
  providerDialog.value = null
  if (route.query.provider === id) {
    const { provider: _gone, ...rest } = route.query
    router.replace({ query: rest })
  }
  await fetchAll().catch(() => undefined)
  await refreshAfterChange()
}

// ---- 筛选（记在浏览器里；搜索词不记） ----
interface Filters {
  kind: ModelKind | ''
  status: '' | 'on' | 'off'
  source: '' | 'builtin' | 'custom'
  price: '' | 'set' | 'unset'
}
const STORE_KEY = 'loomcanvas-models-view'
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  (list as readonly unknown[]).includes(v) ? (v as T) : fallback

function readStored(): Filters {
  let raw: any = null
  try { raw = JSON.parse(lcLocal.getItem(STORE_KEY) || 'null') } catch { /* 读不到或不是 JSON：用默认 */ }
  const f = raw && typeof raw.filters === 'object' && raw.filters ? raw.filters : {}
  return {
    kind: oneOf(f.kind, ['', ...KINDS] as const, ''),
    status: oneOf(f.status, ['', 'on', 'off'] as const, ''),
    source: oneOf(f.source, ['', 'builtin', 'custom'] as const, ''),
    price: oneOf(f.price, ['', 'set', 'unset'] as const, ''),
  }
}

const filters = reactive<Filters>(readStored())
const keyword = ref('')

watch(filters, () => {
  try { lcLocal.setItem(STORE_KEY, JSON.stringify({ filters: { ...filters } })) } catch { /* 隐私模式下写不进去：这次打开照常用 */ }
}, { deep: true })

const statusOptions = computed<{ value: Filters['status']; label: string }[]>(() => [
  { value: '', label: t('modelsPage.filter.statusAll') },
  { value: 'on', label: t('modelsPage.filter.on') },
  { value: 'off', label: t('modelsPage.filter.off') },
])
const sourceOptions = computed<{ value: Filters['source']; label: string }[]>(() => [
  { value: '', label: t('modelsPage.filter.sourceAll') },
  { value: 'builtin', label: t('modelsPage.filter.builtin') },
  { value: 'custom', label: t('modelsPage.filter.custom') },
])
const priceOptions = computed<{ value: Filters['price']; label: string }[]>(() => [
  { value: '', label: t('modelsPage.filter.priceAll') },
  { value: 'set', label: t('modelsPage.filter.priced') },
  { value: 'unset', label: t('modelsPage.filter.unpriced') },
])

const kw = computed(() => keyword.value.trim().toLowerCase())
const filtering = computed(() => readOnly.value
  ? !!filters.kind
  : !!(filters.kind || filters.status || filters.source || filters.price || kw.value))

function matches(m: AdminModel): boolean {
  if (filters.kind && m.kind !== filters.kind) return false
  // 只读时只有「类型」这一项筛选在界面上：别的几项（在别的空间里记下的）不能暗中生效
  if (readOnly.value) return true
  if (filters.status && (filters.status === 'on') !== !!m.enabled) return false
  if (filters.source && (filters.source === 'custom') !== !!m.custom) return false
  if (filters.price && (filters.price === 'set') !== !!m.pricing) return false
  if (kw.value && !m.id.toLowerCase().includes(kw.value) && !(m.label || '').toLowerCase().includes(kw.value)) return false
  return true
}

/** 刚改过、因此不再符合筛选的那几行：留到筛选条件变了为止 */
const kept = ref<Set<string>>(new Set())
watch([filters, kw, () => current.value?.id], () => { kept.value = new Set() }, { deep: true })
const visible = (m: AdminModel) => matches(m) || kept.value.has(m.id)
function keep(id: string) {
  kept.value = new Set(kept.value).add(id)
}

function clearFilters() {
  filters.kind = ''
  filters.status = ''
  filters.source = ''
  filters.price = ''
  keyword.value = ''
}

/** 类型是一组单选：左右 / 上下键换一个，焦点跟过去 */
function onSegKey(e: KeyboardEvent) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  e.preventDefault()
  const next = KIND_TABS[(KIND_TABS.indexOf(filters.kind) + step + KIND_TABS.length) % KIND_TABS.length]
  filters.kind = next
  const group = e.currentTarget as HTMLElement
  requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-kind="${next || 'all'}"]`)?.focus())
}

// ---- 当前服务商的模型 ----
const providerModels = computed(() => models.value.filter(m => m.providerId === current.value?.id))
const kindCounts = computed(() => {
  const out: Record<ModelKind, number> = { image: 0, video: 0, chat: 0 }
  for (const m of providerModels.value) out[m.kind]++
  return out
})
const bySort = (a: AdminModel, b: AdminModel) => (Number(a.sort) || 0) - (Number(b.sort) || 0)
const groups = computed(() => KINDS
  .map(kind => ({ kind, models: providerModels.value.filter(m => m.kind === kind && visible(m)).sort(bySort) }))
  .filter(g => g.models.length))
const shownCount = computed(() => groups.value.reduce((n, g) => n + g.models.length, 0))

// ---- 一行里显示的东西 ----
type TokenPrice = Extract<PricingView, { kind: 'token' }>
type FlatPrice = Extract<PricingView, { kind: 'flat' }>
const priceOf = (m: AdminModel) => pricingView(m.pricing)
/** 「能力」一格的标签：自定义模型先标一个「自定义」 */
function chipsOf(m: AdminModel): CapChip[] {
  const list: CapChip[] = capChips(m).map(text => ({ text }))
  if (m.custom) list.unshift({ text: t('modelsPage.row.custom'), outline: true })
  return list
}

// ---- 一行里的操作 ----
const busy = ref('')
const editing = ref<AdminModel | null>(null)
const renaming = ref<AdminModel | null>(null)

/** 改一项就存一项。成功后用后端返回的那一行替换本地的，并刷新画布用的模型清单 */
async function patch(m: AdminModel, data: Parameters<typeof adminApi.updateModel>[1]): Promise<boolean> {
  if (readOnly.value) return false
  busy.value = m.id
  try {
    const updated = unwrap(await adminApi.updateModel(m.id, data))
    const i = models.value.findIndex(x => x.id === m.id)
    if (i >= 0) {
      const was = visible(models.value[i])
      const next = { ...models.value[i], ...data, ...(updated || {}) }
      models.value[i] = next
      if (was && !matches(next)) keep(next.id)
    }
    loadModels().catch(() => undefined)
    // 启停、改价格都会改变「哪些模型因为金额上限跑不了」
    if (space.isTeam && ('enabled' in data || 'pricing' in data)) void fetchLimits()
    return true
  } catch (err) {
    if (!handledWriteError(err)) MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
    return false
  } finally {
    busy.value = ''
  }
}

async function savePricing(pricing: ModelPricing | null) {
  const m = editing.value
  if (!m) return
  if (await patch(m, { pricing })) {
    editing.value = null
    MessagePlugin.success(t('common.saved'))
  }
}

async function saveRename(data: { label?: string; sort?: number }) {
  const m = renaming.value
  if (!m) return
  if (await patch(m, data)) {
    renaming.value = null
    MessagePlugin.success(t('common.saved'))
  }
}

function menuOf(m: AdminModel): RowMenuItem[] {
  const items: RowMenuItem[] = [{ key: 'rename', label: t('modelsPage.row.rename'), icon: 'edit' }]
  if (m.custom && current.value && vendorOf(current.value)) {
    items.push(
      { key: 'edit-custom', label: t('modelsPage.row.editCustom'), icon: 'tool' },
      { key: 'delete-custom', label: t('modelsPage.row.deleteCustom'), icon: 'trash', danger: true },
    )
  }
  return items
}

function onMenu(m: AdminModel, key: string) {
  if (key === 'rename') renaming.value = m
  else if (key === 'edit-custom') openEditCustom(m)
  else if (key === 'delete-custom') openRemove(m)
}

// ---- 自定义模型 ----
const customDialog = ref<{ provider: ProviderInstance; vendor: Vendor; existing: CustomModel | null } | null>(null)
const removing = ref<{ provider: ProviderInstance; model: AdminModel } | null>(null)
const deleting = ref(false)

const canAddCustom = computed(() => {
  const v = current.value && vendorOf(current.value)
  return !!v && v.customKinds.length > 0
})

function openAddCustom() {
  const provider = current.value
  const vendor = provider && vendorOf(provider)
  if (provider && vendor) customDialog.value = { provider, vendor, existing: null }
}

function openEditCustom(m: AdminModel) {
  const provider = providers.value.find(p => p.id === m.providerId)
  const vendor = provider && vendorOf(provider)
  if (!provider || !vendor) return
  const name = upstreamName(m)
  const saved = provider.customModels.find(c => c.model === name)
  customDialog.value = { provider, vendor, existing: saved || { model: name, kind: m.kind, label: '' } }
}

function openRemove(m: AdminModel) {
  const provider = providers.value.find(p => p.id === m.providerId)
  if (provider) removing.value = { provider, model: m }
}

function cancelRemove() {
  if (!deleting.value) removing.value = null
}
// 确认框的键盘和焦点：进框（落在「取消」上）、Tab 圈在框里、Esc 关、关掉后焦点还回去
const confirmBox = ref<HTMLElement | null>(null)
useDialogFocus(confirmBox, { active: () => !!removing.value, onEscape: cancelRemove, busy: () => deleting.value })

/**
 * 自定义模型变了：这一页和画布用的模型清单都重新取。
 * 新加的、或者改完之后不符合当前筛选的那一个留在列表里（见文件头）。
 */
async function refreshAfterCustom(touched?: string) {
  const before = new Set(models.value.map(m => m.id))
  await fetchAll().catch(() => undefined)
  loadModels().catch(() => undefined)
  for (const m of models.value) {
    if (before.has(m.id) && m.id !== touched) continue
    if (!matches(m)) keep(m.id)
  }
}

async function onCustomSaved() {
  const d = customDialog.value
  // 编辑的是哪一个：靠它去掉前缀的模型名和所属服务商认
  const touched = d?.existing
    ? models.value.find(m => m.providerId === d.provider.id && upstreamName(m) === d.existing!.model)?.id
    : undefined
  customDialog.value = null
  MessagePlugin.success(t('common.saved'))
  await refreshAfterCustom(touched)
}

async function confirmRemove() {
  const r = removing.value
  if (!r) return
  deleting.value = true
  try {
    unwrap(await adminApi.removeCustomModel(r.provider.id, upstreamName(r.model)))
    removing.value = null
    await fetchAll().catch(() => undefined)
    loadModels().catch(() => undefined)
  } catch (err) {
    if (!handledWriteError(err)) MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
.mp-head { min-width: 0; flex: 1 1 320px; }
.ro-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 8px; flex: none;
  font-size: 12px; color: var(--text-2); background: rgb(var(--c-film) / .08); box-shadow: 0 0 0 1px var(--line) inset;
}
.team-note { margin-top: 20px; }
.team-note b { font-weight: 600; color: var(--text); }

/* ---- 两列 ---- */
.mm { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 24px; margin-top: 24px; align-items: start; }
.mm-side, .mm-cards, .mm-provs, .mm-more, .mm-idle { display: grid; gap: 16px; min-width: 0; }

/* ---- 服务商卡片 ---- */
.pc { padding: 16px; display: grid; gap: 12px; min-width: 0; cursor: pointer; transition: border-color .15s; }
.pc:hover:not(.sel) { border-color: var(--line-2); }
.pc.sel { box-shadow: var(--glow-s), var(--sh-1); cursor: default; }
.pc.idle { cursor: default; }
.pc-top { display: flex; align-items: center; gap: 12px; min-width: 0; }
.pi {
  width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; flex: none;
  font: 600 15px var(--f-disp); color: var(--text);
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .25), rgb(var(--c-violet) / .3));
  box-shadow: 0 0 0 1px var(--line-3) inset;
}
.pc-tt { min-width: 0; flex: 1; }
.pc-name-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pc h3 { font: 600 15px/1.4 var(--f-disp); color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-name {
  display: block; max-width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: 4px;
}
.pc-name-row .lc-bd { flex: none; }
.pc-sub {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
  font-size: 12px; line-height: 1.5; color: var(--text-3);
}
.pc dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 12px; margin: 0; font-size: 13px; }
.pc dt { color: var(--text-3); white-space: nowrap; }
.pc dd { margin: 0; text-align: right; color: var(--text-2); min-width: 0; }
.pc dd .lc-st { justify-content: flex-end; }
.key-tail { font-size: 12px; }
.key-team { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.key-lost { color: var(--err-soft); }
.pc-url { font-size: 12px; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-when { font-variant-numeric: tabular-nums; }
.pc-who { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.pc-who :deep(.pn) { justify-content: flex-end; }
.pc-who :deep(.pn-tag) { height: 18px; padding: 0 6px; font-size: 11px; }
.pc-who small { color: var(--text-3); font-size: 12px; font-variant-numeric: tabular-nums; }
.pc-msg { font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; color: var(--err-soft); }
.pc-ops { display: flex; gap: 8px; }
.pc-ops .lc-btn { flex: 1; min-width: 0; }
.fill-key { border-color: var(--line-3); color: var(--cyan-soft); }
.spinning { animation: spin 1s linear infinite; }

.padd {
  min-height: 56px; padding: 10px 14px; border: 1px dashed var(--line-3); border-radius: var(--r-md); background: none;
  display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--text-2); font-size: 13px; line-height: 1.5; text-align: left;
  transition: border-color .15s, color .15s, background .15s;
}
.padd:hover:not(:disabled) { border-color: var(--cyan); color: var(--text); background: rgb(var(--c-cyan) / .05); }
.padd:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.padd:disabled { opacity: .45; cursor: not-allowed; }

.mm-about { padding: 16px; }
.mm-about b { font-weight: 600; color: var(--text); }
.about-ic { color: var(--cyan); }
.mm-about p { font-size: 13px; line-height: 1.7; margin-top: 8px; color: var(--text-2); }

/* ---- 模型面板 ---- */
.mpanel { overflow: hidden; min-width: 0; }
.mp-top { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 20px 20px 16px; }
.mp-tt { min-width: 0; flex: 1 1 200px; }
.mp-tt h2 { font: 600 17px/1.4 var(--f-disp); color: var(--text); overflow-wrap: anywhere; }
.mp-counts { display: block; font-size: 12px; color: var(--text-3); }
.mp-top .lc-sp { flex: 0 1 0; }
.mp-alert { margin: 0 20px 16px; }
/* 提示里带一颗「去重填」的按钮：一行放得下就靠右，放不下换到下一行 */
.mp-alert { flex-wrap: wrap; }
.mp-alert > span { flex: 1 1 260px; min-width: 0; }
.mp-alert-act { flex: none; margin-left: auto; }
.mp-fbar { padding: 0 20px 16px; }
.f-select { flex: none; width: 116px; }
.mp-fbar .f-search { flex: 1 1 140px; }
.f-search input::-webkit-search-cancel-button { cursor: pointer; filter: var(--native-invert); }

/* 五列固定宽度：各组之间的行才能纵向对齐 */
.mcols, .mrow {
  display: grid; grid-template-columns: 36px 200px minmax(0, 1fr) 148px 104px; gap: 16px; align-items: center; padding: 0 20px;
}
/* 只读：没有操作列，筛选只剩标题右边的类型 */
.mpanel.ro .mcols, .mpanel.ro .mrow { grid-template-columns: 36px 220px minmax(0, 1fr) 150px; }
/* 有「暂不可运行」的标签时价格列放宽一点，标签才放得下一行 */
@media (min-width: 901px) {
  .mpanel.blk .mcols, .mpanel.blk .mrow { grid-template-columns: 36px 200px minmax(0, 1fr) 176px 104px; }
}
/* 没有价格一列（集成方关了成本显示）：其余的列宽不变 */
.mpanel.no-price .mcols, .mpanel.no-price .mrow { grid-template-columns: 36px 200px minmax(0, 1fr) 104px; }
.mpanel.no-price.ro .mcols, .mpanel.no-price.ro .mrow { grid-template-columns: 36px 220px minmax(0, 1fr); }
.mpanel.no-price .c-act { justify-self: end; }
.mpanel.ro .mp-top { padding-bottom: 20px; }
.ro-seg { flex: none; }
.lc-switch.ro { opacity: .55; cursor: not-allowed; }
.blocked-tag { max-width: 100%; display: inline-block; line-height: 22px; overflow: hidden; text-overflow: ellipsis; vertical-align: top; cursor: help; }
.c-price .lc-tag:focus-visible, .kept-tag:focus-visible, .pp-line:focus-visible { outline: none; box-shadow: var(--ring); }
.mcols { height: 36px; font-size: 12px; color: var(--text-3); border-top: 1px solid var(--line); background: rgb(var(--c-well) / .35); }
.c-act-h { text-align: right; }
.mgrp { height: 40px; padding: 0 20px; border-top: 1px solid var(--line); background: rgb(var(--c-film) / .05); display: flex; align-items: center; }
.mgrp-in { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-3); }
/* 行高按最高的那种内容定（按 token 计价：一对价格两行 + 单位一行），所有行一样高 */
.mrow { min-height: 72px; padding-top: 8px; padding-bottom: 8px; border-top: 1px solid var(--line); transition: background .12s; }
.mrow:hover { background: rgb(var(--c-film) / .035); }
.c-sw { display: flex; }
.c-name { min-width: 0; }
.c-name b { display: block; font-weight: 600; font-size: 14px; line-height: 1.3; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.c-name small { display: block; font: 12px/1.3 var(--f-mono); color: var(--text-3); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.c-caps { display: flex; align-items: center; gap: 6px; min-width: 0; }
.kept-tag { cursor: help; flex: none; }
.c-price { font-size: 13px; line-height: 18px; color: var(--text-2); min-width: 0; font-variant-numeric: tabular-nums; }
/* 输入 / 输出：两行两列，标签一列、金额一列右对齐 —— 两种语言下都是整整齐齐的一对 */
/* 一对的最小宽度定住：各行金额的右边缘落在同一条线上（金额特别长的那一行自己撑开） */
.pp-pair { display: inline-grid; grid-template-columns: auto 1fr; column-gap: 10px; min-width: 116px; white-space: nowrap; vertical-align: top; }
.pp-l { color: var(--text-3); text-align: left; }
.pp-v { text-align: right; color: var(--text); }
.pp-amt { display: block; white-space: nowrap; color: var(--text); overflow: hidden; text-overflow: ellipsis; }
.pp-unit { display: block; font-size: 12px; line-height: 16px; color: var(--text-3); white-space: nowrap; }
.pp-line { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 4px; }
.pp-line + .blocked-tag { margin-top: 4px; }
.c-act { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.mrow.off .c-name b, .mrow.off .c-caps, .mrow.off .c-price { opacity: .5; }
.mp-none { border-top: 1px solid var(--line); }
.mp-none p { margin-bottom: 12px; }
.mp-none p:last-child { margin-bottom: 0; }

/* ---- 整页状态 ---- */
.mp-state {
  margin: 24px auto 0; max-width: 560px; padding: 40px 28px;
  display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
}
.mp-state-ic.err { color: var(--err); }
.mp-state-title { font: 600 17px/1.4 var(--f-disp); color: var(--text); }
.mp-state-text { font-size: 13px; line-height: 1.7; color: var(--text-2); max-width: 420px; overflow-wrap: anywhere; }
.mp-state .lc-btn { margin-top: 10px; }
.mp-empty { margin-top: 40px; box-shadow: var(--sh-1); }
.mp-empty-ic {
  width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; color: var(--cyan); margin-bottom: 6px;
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .2), rgb(var(--c-violet) / .26)); box-shadow: 0 0 0 1px var(--line-3) inset;
}
.mp-empty-about { max-width: 560px; margin: 16px auto 0; }

/* ---- 骨架 ---- */
.sk { display: block; border-radius: 6px; background: var(--skel-bg); animation: lc-pulse 1.6s ease-in-out infinite; }
.sk-card { cursor: default; }
.sk-pi { width: 40px; height: 40px; border-radius: 11px; flex: none; }
.sk-lines { display: grid; gap: 8px; min-width: 0; }
.sk-bar { padding: 0 20px 16px; }
.sk-row { display: flex; align-items: center; gap: 16px; height: 72px; padding: 0 20px; border-top: 1px solid var(--line); }
.sk-row .sk-lines { width: 200px; flex: none; }
.sk-grow { flex: 1; max-width: 240px; }

.confirm { width: 420px; }
.confirm p { line-height: 1.7; color: var(--text-2); }

/* ---- 窄一些：两列叠起来。服务商不再是一条要横着滑的卡片（滑过去才知道后面还有），
        而是排成自动换行的格子：已添加的各占一格，「还可以添加的」收成小条、合起来占一格。全都看得见，不用滑。
        断点放在 1400：再窄的话并排的两列里模型表只剩六七百像素，「能力」一列挤得一个标签都放不下。 ---- */
@media (max-width: 1400px) {
  .mm { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .mm-side { display: contents; }
  .mm-cards { grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 12px; align-items: stretch; }
  .mm-provs, .mm-idle { display: contents; }
  .mm-provs > .pc { align-content: start; }
  .mm-more { display: flex; flex-direction: column; gap: 8px; }
  .pc.idle { grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 12px; }
  .pc.idle .pc-top { display: contents; }
  .pc.idle .pi { width: 32px; height: 32px; border-radius: 9px; font-size: 13px; }
  .pc.idle dl, .pc.idle .pc-sub { display: none; }
  .pc.idle .pc-ops .lc-btn { flex: none; }
  .mm-more .padd { flex: 1 1 auto; min-height: 52px; }
  /* 关于价格：排到模型表后面 */
  .mm-about { order: 3; }
  /* 只有一家服务商、又没有「还可以添加的」（成员看到的）：卡片旁边空着半行，把说明挪上来补在旁边 */
  .mm-side.ro.one { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 12px; align-items: stretch; }
  .mm-side.ro.one .mm-cards { display: contents; }
  .mm-side.ro.one .mm-about { order: 0; }
}

/* ---- 窄窗口、平板、手机：一行两段 —— 开关 + 名称 + 价格 / 操作，能力标签折到下面。
        断点放在 900：再宽一点五列才排得下——固定的四列加间距要 620px，面板比这宽不了多少的时候
        「能力」一列只剩几十像素，标签被压成一个字、表头叠在一起。 ---- */
@media (max-width: 900px) {
  .mcols { display: none; }
  .mrow {
    grid-template-columns: 36px minmax(0, 1fr) auto;
    grid-template-areas:
      'sw name price'
      'sw name act'
      '. caps caps';
    gap: 4px 12px; padding-top: 12px; padding-bottom: 12px;
  }
  .c-sw { grid-area: sw; align-self: start; padding-top: 6px; }
  .c-name { grid-area: name; align-self: center; }
  .c-name b, .c-name small { white-space: normal; overflow-wrap: anywhere; }
  .c-price { grid-area: price; text-align: right; font-size: 12px; max-width: 180px; justify-self: end; }
  .c-price .lc-unk { font-size: 12px; }
  .c-act { grid-area: act; }
  .mpanel.ro .mcols, .mpanel.ro .mrow { grid-template-columns: 36px minmax(0, 1fr) auto; }
  .mpanel.ro .mrow { grid-template-areas: 'sw name price' '. caps caps'; }
  .mpanel.no-price .mrow { grid-template-columns: 36px minmax(0, 1fr) auto; grid-template-areas: 'sw name act' '. caps caps'; }
  .mpanel.no-price.ro .mcols, .mpanel.no-price.ro .mrow { grid-template-columns: 36px minmax(0, 1fr); }
  .mpanel.no-price.ro .mrow { grid-template-areas: 'sw name' '. caps'; }
  .c-caps { grid-area: caps; margin-top: 4px; }
  .sk-row .sk-lines { width: auto; flex: 1; }
  .sk-grow { display: none; }
}
@media (max-width: 720px) {
  .mp-top { padding: 16px 14px 14px; }
  .mp-top .lc-btn.primary { width: 100%; }
  .mp-alert { margin: 0 14px 14px; }
  .mp-fbar { padding: 0 14px 14px; }
  .mp-fbar .lc-seg { width: 100%; }
  .mp-fbar .lc-seg > button { flex: 1; justify-content: center; }
  .f-select { flex: 1 1 0; width: auto; min-width: 0; }
  .f-select :deep(.lcs-trigger) { padding: 0 8px; gap: 4px; font-size: 12px; }
  .mp-fbar .f-search { flex: 1 1 100%; }
  .mgrp { padding: 0 14px; }
  .mrow { padding-left: 14px; padding-right: 14px; }
  .c-price { max-width: 150px; }
  .mpanel.ro .ro-seg { width: 100%; }
  .mpanel.ro .ro-seg > button { flex: 1; justify-content: center; }
  .ro-chip { order: 3; }
  .mp-state { padding: 32px 18px; }
}
</style>
