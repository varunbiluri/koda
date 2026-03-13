import type { Skill, SkillCategory, SkillMatch } from './types.js';

/**
 * SkillRegistry - Manages available skills and matches them to tasks
 */
export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private categorized: Map<SkillCategory, Skill[]> = new Map();

  constructor() {
    this.registerDefaultSkills();
  }

  /**
   * Register a skill
   */
  register(skill: Skill): void {
    this.skills.set(skill.id, skill);

    if (!this.categorized.has(skill.category)) {
      this.categorized.set(skill.category, []);
    }

    this.categorized.get(skill.category)!.push(skill);
  }

  /**
   * Get skill by ID
   */
  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /**
   * Get skills by category
   */
  getByCategory(category: SkillCategory): Skill[] {
    return this.categorized.get(category) || [];
  }

  /**
   * Get all skills
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Find matching skills for a task
   */
  findMatches(task: string, topK: number = 5): SkillMatch[] {
    const taskLower = task.toLowerCase();
    const matches: SkillMatch[] = [];

    for (const skill of this.skills.values()) {
      const score = this.scoreMatch(taskLower, skill);

      if (score > 0.3) {
        matches.push({
          skill,
          score,
          reasoning: this.explainMatch(task, skill, score),
        });
      }
    }

    // Sort by score and success rate
    matches.sort((a, b) => {
      const scoreA = a.score * (0.7 + a.skill.successRate * 0.3);
      const scoreB = b.score * (0.7 + b.skill.successRate * 0.3);
      return scoreB - scoreA;
    });

    return matches.slice(0, topK);
  }

  /**
   * Score how well a skill matches a task
   */
  private scoreMatch(taskLower: string, skill: Skill): number {
    let score = 0;

    // Check name match
    if (taskLower.includes(skill.name.toLowerCase())) {
      score += 0.5;
    }

    // Check tag matches
    for (const tag of skill.tags) {
      if (taskLower.includes(tag.toLowerCase())) {
        score += 0.2;
      }
    }

    // Check description match
    const descWords = skill.description.toLowerCase().split(/\s+/);
    for (const word of descWords) {
      if (word.length > 4 && taskLower.includes(word)) {
        score += 0.1;
      }
    }

    // Check examples
    for (const example of skill.examples) {
      const exampleWords = example.task.toLowerCase().split(/\s+/);
      let exampleScore = 0;
      for (const word of exampleWords) {
        if (word.length > 4 && taskLower.includes(word)) {
          exampleScore += 0.05;
        }
      }
      score += Math.min(0.3, exampleScore);
    }

    return Math.min(1, score);
  }

  /**
   * Explain why a skill matches
   */
  private explainMatch(task: string, skill: Skill, score: number): string {
    const reasons: string[] = [];

    if (task.toLowerCase().includes(skill.name.toLowerCase())) {
      reasons.push('task mentions skill name');
    }

    const matchingTags = skill.tags.filter((tag) =>
      task.toLowerCase().includes(tag.toLowerCase()),
    );
    if (matchingTags.length > 0) {
      reasons.push(`matches tags: ${matchingTags.join(', ')}`);
    }

    if (skill.useCount > 0) {
      reasons.push(`previously used ${skill.useCount} times with ${Math.round(skill.successRate * 100)}% success`);
    }

    return reasons.join('; ') || 'general similarity';
  }

  /**
   * Update skill statistics after use
   */
  updateStats(skillId: string, success: boolean): void {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    skill.useCount++;
    skill.lastUsed = new Date().toISOString();

    // Update success rate (exponential moving average)
    const alpha = 0.1; // Smoothing factor
    const newRate = success ? 1 : 0;
    skill.successRate = skill.successRate * (1 - alpha) + newRate * alpha;
  }

  /**
   * Register default skills
   */
  private registerDefaultSkills(): void {
    // JWT Authentication skill
    this.register({
      id: 'jwt-auth',
      name: 'JWT Authentication Setup',
      category: 'authentication',
      description: 'Set up JWT-based authentication with token generation and verification',
      pattern: {
        type: 'code-template',
        template: `
// JWT Authentication Setup
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || '{{secret}}';

export function generateToken(payload: {{payloadType}}) {
  return jwt.sign(payload, SECRET, { expiresIn: '{{expiration}}' });
}

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, SECRET);
  } catch (error) {
    return null;
  }
}

export function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.user = payload;
  next();
}
`.trim(),
        variables: [
          {
            name: 'secret',
            description: 'JWT secret key',
            type: 'string',
            required: true,
          },
          {
            name: 'expiration',
            description: 'Token expiration time',
            type: 'string',
            default: '24h',
            required: false,
          },
          {
            name: 'payloadType',
            description: 'TypeScript type for JWT payload',
            type: 'string',
            default: 'any',
            required: false,
          },
        ],
        steps: [
          'Install jsonwebtoken package',
          'Create authentication utilities',
          'Add middleware for protected routes',
          'Update environment configuration',
        ],
      },
      examples: [
        {
          task: 'Add JWT authentication to the API',
          variables: {
            secret: 'your-secret-key',
            expiration: '7d',
            payloadType: '{ userId: string; email: string }',
          },
          result: 'Created auth utilities and middleware',
          success: true,
        },
      ],
      tags: ['jwt', 'authentication', 'security', 'token', 'middleware'],
      useCount: 0,
      successRate: 0.8,
      createdAt: new Date().toISOString(),
    });

    // REST API Generation
    this.register({
      id: 'rest-api',
      name: 'REST API Endpoint',
      category: 'api',
      description: 'Create a RESTful API endpoint with CRUD operations',
      pattern: {
        type: 'code-template',
        template: `
// {{resourceName}} API Routes
import express from 'express';

const router = express.Router();

// GET /{{route}}
router.get('/{{route}}', async (req, res) => {
  try {
    const items = await {{model}}.findAll();
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /{{route}}/:id
router.get('/{{route}}/:id', async (req, res) => {
  try {
    const item = await {{model}}.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /{{route}}
router.post('/{{route}}', async (req, res) => {
  try {
    const item = await {{model}}.create(req.body);
    res.status(201).json(item);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /{{route}}/:id
router.put('/{{route}}/:id', async (req, res) => {
  try {
    const item = await {{model}}.update(req.params.id, req.body);
    res.json(item);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /{{route}}/:id
router.delete('/{{route}}/:id', async (req, res) => {
  try {
    await {{model}}.delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
`.trim(),
        variables: [
          {
            name: 'resourceName',
            description: 'Name of the resource (e.g., User, Post)',
            type: 'string',
            required: true,
          },
          {
            name: 'route',
            description: 'API route path',
            type: 'string',
            required: true,
          },
          {
            name: 'model',
            description: 'Model/service name',
            type: 'string',
            required: true,
          },
        ],
        steps: [
          'Create route file',
          'Implement CRUD operations',
          'Add error handling',
          'Register routes in app',
        ],
      },
      examples: [],
      tags: ['api', 'rest', 'crud', 'express', 'routes'],
      useCount: 0,
      successRate: 0.85,
      createdAt: new Date().toISOString(),
    });

    // React Form
    this.register({
      id: 'react-form',
      name: 'React Form Component',
      category: 'ui',
      description: 'Create a React form component with validation',
      pattern: {
        type: 'code-template',
        template: `
import { useState } from 'react';

interface {{formName}}Data {
  {{fields}}
}

export function {{formName}}() {
  const [formData, setFormData] = useState<{{formName}}Data>({
    {{defaultValues}}
  });

  const [errors, setErrors] = useState<Partial<{{formName}}Data>>({});

  const validate = (): boolean => {
    const newErrors: Partial<{{formName}}Data> = {};

    {{validation}}

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    try {
      {{onSubmit}}
    } catch (error) {
      console.error('Form submission error:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {{formFields}}

      <button type="submit">Submit</button>
    </form>
  );
}
`.trim(),
        variables: [
          {
            name: 'formName',
            description: 'Form component name',
            type: 'string',
            required: true,
          },
          {
            name: 'fields',
            description: 'Form field definitions',
            type: 'string',
            required: true,
          },
        ],
        steps: [
          'Create form component',
          'Add state management',
          'Implement validation',
          'Add submit handler',
        ],
      },
      examples: [],
      tags: ['react', 'form', 'ui', 'validation', 'component'],
      useCount: 0,
      successRate: 0.75,
      createdAt: new Date().toISOString(),
    });
  }
}

// Singleton instance
export const skillRegistry = new SkillRegistry();
