import { test, expect } from 'vitest';
import { Description, SchemaGenerator } from './helpers';

// Test class with various types and descriptions
class TestClass {
    @Description('A simple string field')
    stringField: string = '';

    @Description('A number value')
    numberField: number = 0;

    @Description('A boolean flag')
    booleanField: boolean = false;

    plainField: string = '';
}

class SimpleClass {
    field: string = '';
}

test('SchemaGenerator - should generate correct prompt with descriptions', () => {
    const prompt = SchemaGenerator.generateJSONSchema(TestClass);
    const expected = `Answer in JSON using this schema:
{
  // A simple string field
  stringField: string,
  // A number value
  numberField: float,
  // A boolean flag
  booleanField: boolean,
  plainField: string,
}`;
    
    expect(prompt).toBe(expected);
});

test('SchemaGenerator - should handle classes without descriptions', () => {
    const prompt = SchemaGenerator.generateJSONSchema(SimpleClass);
    expect(prompt).toContain('field: string');
    expect(prompt).not.toContain('//');
});

test('Description decorator - should store description metadata', () => {
    const instance = new TestClass();
    const description = Reflect.getMetadata('description', instance, 'stringField');
    expect(description).toBe('A simple string field');
});

test('Type handling - should handle different types correctly', () => {
    class TypeTestClass {
        stringArr: string[] = [];
        customObj: TestClass = new TestClass();
    }

    const prompt = SchemaGenerator.generateJSONSchema(TypeTestClass);

    const expected = `Answer in JSON using this schema:
{
  stringArr: string[],
  customObj: {
        stringField: string,
        numberField: number,
        booleanField: boolean,
        plainField: string,
    },
}`;

    expect(prompt).toBe(expected);

});

test('Array handling - should handle array types correctly', () => {
    class ArrayTestClass {
        names: string[] = [];
        experiences: string[] = [];
    }

    const prompt = SchemaGenerator.generateJSONSchema(ArrayTestClass);
    const expected = `Answer in JSON using this schema:
{
  names: string[],
  experiences: string[],
}`;
    expect(prompt).toBe(expected);
});


