@extends('cabinet::admin.layout')

@section('title')
	{{ Lang::get('cabinet::wardrobe.posts') }}
@stop

@section('content')

	<table class="table center-col">
		<tr>
			<th>{{ Lang::get('cabinet::wardrobe.post_title') }}</th>
			<th>{{ Lang::get('cabinet::wardrobe.post_status') }}</th>
			<th>{{ Lang::get('cabinet::wardrobe.post_published') }}</th>
			<th></th>
		</tr>
		@foreach ($posts as $post)
		<tr>
			@include('cabinet::admin.posts.item')
		</tr>
		@endforeach
	</table>

	{{ $posts->links() }}

@stop
