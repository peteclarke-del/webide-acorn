// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_CATALOGUE,
  projectFromTemplate,
  templateFit,
  templatesForMachine,
  validateTemplateCatalogue,
  type ProjectTemplate,
} from './templateCatalogue';
import { assembleProject6502 } from '../build/projectAssembler6502';
import { tokenizeBasic } from '../build/basicTokeniser';
import { toolchainFor, validateBuildTarget } from '../build/buildTarget';
import { machineProfiles } from '../data/machines';
import type { MachineProfile } from '../types';

const bbcB = machineProfiles.find((machine) => machine.id === 'bbc-b')!;

describe('the shipped template catalogue', () => {
  it('is internally consistent, so a broken template fails here rather than in someone’s session', () => {
    expect(validateTemplateCatalogue()).toEqual([]);
  });

  it('ships two templates for the first machine slice, each with unique identity', () => {
    expect(TEMPLATE_CATALOGUE).toHaveLength(2);
    expect(new Set(TEMPLATE_CATALOGUE.map((template) => template.id)).size).toBe(2);
    for (const template of TEMPLATE_CATALOGUE) expect(template.target.machineId).toBe('bbc-b');
  });

  it('records where every template came from and under what licence', () => {
    /* The licence review at the end of this project needs a statement to
     * check, not an assumption to make. */
    for (const template of TEMPLATE_CATALOGUE) {
      expect(template.provenance.author).toBe('8bit-net Dev');
      expect(template.provenance.licence).toBe('MIT');
      expect(template.provenance.note).toMatch(/documented|original/i);
    }
  });

  it('reports every kind of problem a template could have, rather than the first', () => {
    const broken = {
      ...TEMPLATE_CATALOGUE[0]!,
      id: '',
      name: ' ',
      summary: '',
      highlights: [],
      entryFileName: 'absent.asm',
      provenance: { author: '', licence: '', note: '' },
    } as ProjectTemplate;
    const problems = validateTemplateCatalogue([broken]).map((problem) => problem.problem);
    expect(problems).toEqual(expect.arrayContaining([
      'has no identifier',
      'has no name',
      'has no summary',
      'claims nothing about what it offers',
      'names absent.asm as its entry file, which is not among its files',
      'does not record where its code came from and under what licence',
    ]));
  });

  it('catches two templates sharing an identifier', () => {
    const twice = [TEMPLATE_CATALOGUE[0]!, TEMPLATE_CATALOGUE[0]!];
    expect(validateTemplateCatalogue(twice).map((problem) => problem.problem))
      .toContain('shares its identifier with another template');
  });
});

describe('a template against the machine in front of you', () => {
  it('fits the machine it declares', () => {
    for (const template of TEMPLATE_CATALOGUE) expect(templateFit(template)).toEqual({ fits: true, problems: [] });
  });

  it('says which machine profile is missing rather than offering the template anyway', () => {
    const [template] = TEMPLATE_CATALOGUE;
    const fit = templateFit(template!, []);
    expect(fit.fits).toBe(false);
    expect(fit.problems[0]).toContain('no machine profile called bbc-b');
  });

  it('names an absent variant, ROM set and capability separately', () => {
    const stripped: MachineProfile = { ...bbcB, variants: ['Model B · cassette'], roms: [], capabilities: [] };
    const disk = TEMPLATE_CATALOGUE.find((template) => template.requiredCapabilities.includes('dfs'))!;
    const fit = templateFit(disk, [stripped]);
    expect(fit.fits).toBe(false);
    expect(fit.problems.join(' ')).toContain('no variant called Model B · 8271 DFS');
    expect(fit.problems.join(' ')).toContain('no ROM set called os12-basic2-dfs');
    expect(fit.problems.join(' ')).toContain('does not offer dfs');
  });

  it('refuses a template whose capability is planned rather than fitted', () => {
    /* Planned means not fitted. Offering a template that depends on one would
     * be claiming hardware the machine does not have. */
    const planned: MachineProfile = {
      ...bbcB,
      capabilities: bbcB.capabilities.map((capability) => capability.id === 'dfs' ? { ...capability, state: 'planned' as const } : capability),
    };
    const disk = TEMPLATE_CATALOGUE.find((template) => template.requiredCapabilities.includes('dfs'))!;
    const fit = templateFit(disk, [planned]);
    expect(fit.fits).toBe(false);
    expect(fit.problems[0]).toContain('planned rather than fitted');
  });

  it('offers the templates a machine can run and reports the ones it cannot', () => {
    const cassetteOnly: MachineProfile = { ...bbcB, capabilities: bbcB.capabilities.filter((capability) => capability.id !== 'dfs') };
    const result = templatesForMachine('bbc-b', [cassetteOnly]);
    expect(result.available.map((template) => template.id)).toEqual(['bbc-b-mode7-6502']);
    expect(result.unavailable.map((entry) => entry.template.id)).toEqual(['bbc-b-disk-basic']);
    expect(result.unavailable[0]!.problems[0]).toContain('does not offer dfs');
  });

  it('offers nothing for a machine no template was written for', () => {
    expect(templatesForMachine('archimedes-a3000')).toEqual({ available: [], unavailable: [] });
  });
});

describe('opening a template as a project', () => {
  for (const template of TEMPLATE_CATALOGUE) {
    describe(template.name, () => {
      const project = projectFromTemplate(template);

      it('parses through the ordinary project parser, keeping every file', () => {
        expect(project.files).toHaveLength(template.files.length);
        expect(project.files.map((file) => file.name)).toEqual(template.files.map((file) => file.name));
        expect(project.buildTargets).toHaveLength(1);
        expect(project.target.machineId).toBe(template.target.machineId);
        /* Nothing arrives already modified: a template is a saved starting
         * point, not an unsaved edit someone has to reconcile. */
        for (const file of project.files) expect(file.modified).toBe(false);
      });

      it('declares a build target that validates against the machine it names', () => {
        const machine = machineProfiles.find((candidate) => candidate.id === project.target.machineId)!;
        const target = project.buildTargets[0]!;
        expect(validateBuildTarget(target, project.files, machine, project.buildTargets)).toEqual([]);
        expect(project.files.some((file) => file.id === target.entryFileId)).toBe(true);
      });

      it('builds with no diagnostics, and builds the same bytes twice', () => {
        const target = project.buildTargets[0]!;
        const entry = project.files.find((file) => file.id === target.entryFileId)!;
        const toolchain = toolchainFor(target.toolchainId)!;
        const build = () => toolchain.language === 'bbc-basic'
          ? tokenizeBasic(entry.content)
          : assembleProject6502(entry.id, project.files, '6502', { defaultOrigin: 0x1900, maximumAddress: 0x57ff });
        const artifact = build();
        expect(artifact.diagnostics).toEqual([]);
        expect(artifact.bytes.length).toBeGreaterThan(0);
        expect(Array.from(build().bytes)).toEqual(Array.from(artifact.bytes));
      });

      it('takes the project name it is given, and its own when given none', () => {
        expect(projectFromTemplate(template, '  My game  ').name).toBe('My game');
        expect(projectFromTemplate(template, '   ').name).toBe(template.name);
      });
    });
  }

  it('refuses to open a template that does not fit, rather than opening a project that cannot build', () => {
    const disk = TEMPLATE_CATALOGUE.find((template) => template.requiredCapabilities.includes('dfs'))!;
    const impossible: ProjectTemplate = { ...disk, requiredCapabilities: ['econet'] };
    expect(() => projectFromTemplate(impossible)).toThrow(/planned rather than fitted/);
  });

  it('refuses a template whose entry file is not among its files', () => {
    const broken: ProjectTemplate = { ...TEMPLATE_CATALOGUE[0]!, entryFileName: 'absent.asm' };
    expect(() => projectFromTemplate(broken)).toThrow(/which is not among its files/);
  });
});
