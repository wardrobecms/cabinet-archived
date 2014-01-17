@extends('cabinet::admin.layout')

@section('title')
	{{ Lang::get('cabinet::wardrobe.post_edit') }}
@stop

@section('content')

	{{ Form::model($post, array('method' => 'put', 'route' => array('wardrobe.post.update', $post->id))) }}

		{{ Form::text('title') }}
		{{ Form::text('slug') }}
		{{ Form::text('publish_date') }}

		{{ Form::textarea('content') }}

		{{ Form::select('active', array('1' => 'Yes', '0' => 'No')) }}

		{{ Form::submit('Save') }}

	{{ Form::close() }}
@stop
