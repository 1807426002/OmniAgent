<script setup lang="ts">
import { computed } from 'vue';
import { useExtensionStore } from '../../src/stores/extension';

const extension = useExtensionStore();
const status = computed(() => (extension.ready ? '基础工程已就绪' : '正在初始化'));
</script>

<template>
  <main class="panel-shell">
    <section class="hero">
      <p class="eyebrow">OMNIAGENT</p>
      <h1>One memory.<br />Every AI.</h1>
      <p class="description">{{ status }}</p>
    </section>
    <el-alert title="第一阶段：扩展基础工程" type="info" :closable="false" show-icon />
  </main>
</template>
